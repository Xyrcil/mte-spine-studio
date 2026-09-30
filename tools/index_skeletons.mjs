import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.argv[2] || 'public/assets');
const context = vm.createContext({console, TextDecoder, Float32Array, Int16Array, Uint16Array, Uint8Array, ArrayBuffer, Math});
vm.runInContext(fs.readFileSync('public/vendor/spine-webgl.js', 'utf8'), context);
const spine = context.spine;
const extraction = JSON.parse(fs.readFileSync(path.join(root, 'extraction.json')));
const entries = [];
for (const bundle of extraction.bundles) {
  for (const item of bundle.skeletons) {
    const entry = {bundle: bundle.id, path: bundle.path, ...item};
    try {
      if (!item.version.startsWith('3.8.')) throw new Error(`Unsupported runtime ${item.version}`);
      const directory = path.join(root, bundle.path);
      const atlasPath = path.join(directory, item.id, item.atlases[0].atlas);
      const atlas = new spine.TextureAtlas(fs.readFileSync(atlasPath, 'utf8'), (filename) => {
        const png = fs.readFileSync(path.join(path.dirname(atlasPath), filename));
        return new spine.FakeTexture({width: png.readUInt32BE(16), height: png.readUInt32BE(20)});
      });
      const loader = new spine.AtlasAttachmentLoader(atlas);
      const reader = item.skeleton.endsWith('.json') ? new spine.SkeletonJson(loader) : new spine.SkeletonBinary(loader);
      reader.scale = item.scale;
      const raw = fs.readFileSync(path.join(directory, item.skeleton));
      const data = reader.readSkeletonData(item.skeleton.endsWith('.json') ? JSON.parse(raw) : new Uint8Array(raw));
      const skeleton = new spine.Skeleton(data);
      skeleton.setToSetupPose();
      skeleton.updateWorldTransform();
      const offset = new spine.Vector2(), size = new spine.Vector2();
      skeleton.getBounds(offset, size, []);
      entry.bounds = [offset.x, offset.y, size.x, size.y];
      entry.animations = data.animations.map(animation => ({
        name: animation.name, duration: animation.duration,
        events: animation.timelines.flatMap(t => t.events ? t.events.map(event => ({time: event.time, name: event.data.name, int: event.intValue, float: event.floatValue, string: event.stringValue})) : [])
      }));
      entry.bones = data.bones.map(bone => bone.name);
      entry.skins = data.skins.map(skin => skin.name);
      entry.status = 'parsed';
    } catch (error) {
      entry.status = 'error';
      entry.error = String(error.message);
    }
    entries.push(entry);
  }
}
const result = {schema: 1, entries, summary: {total: entries.length, parsed: entries.filter(x => x.status === 'parsed').length, failed: entries.filter(x => x.status === 'error').length}};
fs.writeFileSync(path.join(root, 'runtime-index.json'), JSON.stringify(result, null, 2));
console.log(result.summary);
for (const entry of entries.filter(x => x.status === 'error').slice(0, 10)) console.log(entry.bundle, entry.id, entry.error);
