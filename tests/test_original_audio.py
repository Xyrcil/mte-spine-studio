import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from original_audio import audio_source, canonical_names, canonical_audio_name, mark_shared_cues
from source_archive import sanitize_diagnostics


class OriginalAudioTests(unittest.TestCase):
    def test_shared_short_cues_are_marked_without_discarding_original_audio(self):
        first, second, unique = {"clips": [{"path": "first.m4a"}]}, {"clips": [{"path": "second.m4a"}]}, {"clips": [{"path": "unique.m4a"}]}
        mark_shared_cues({"same PCM": [first, second], "different PCM": [unique]})
        self.assertTrue(first["clips"][0]["sharedShortCue"])
        self.assertTrue(second["clips"][0]["sharedShortCue"])
        self.assertEqual(first["clips"][0]["path"], "first.m4a")
        self.assertNotIn("sharedShortCue", unique["clips"][0])
    def test_native_casing_is_used_only_without_a_declared_resource_name(self):
        self.assertEqual(canonical_audio_name("voice_actor", "Voice_Actor"), "Voice_Actor")
        self.assertEqual(canonical_audio_name("voice_actor", "Voice_Other"), "voice_actor")
        self.assertEqual(canonical_audio_name("voice_op", "Voice_Op", "Voice_OP"), "Voice_OP")
    def test_source_categories_keep_language_tracks_distinct(self):
        prefix = "package/files/vercache_demo/sound/"
        self.assertEqual(audio_source(prefix + "a_sound_voiceeff/voice_actor.data"), ("a_sound_voiceeff", "voice_actor"))
        self.assertEqual(audio_source(prefix + "a_sound_voiceeff_ch/voice_actor.data"), ("a_sound_voiceeff_ch", "voice_actor"))
        self.assertIsNone(audio_source("unrelated.data"))

    def test_source_paths_reject_nested_or_platform_escaped_resources(self):
        prefix = "package/files/vercache_demo/sound/"
        for path in ["../voice.data", "category/../voice.data", "category/C:voice.data", "category/a\\b.data"]:
            with self.assertRaises(ValueError):
                audio_source(prefix + path)

    def test_canonical_resource_names_do_not_use_logical_aliases(self):
        self.assertEqual(canonical_names([{"name": "Alias", "resource": "SoundRes/a_sound_voiceeff/Voice_Actor_Original"}]), {"voice_actor_original": "Voice_Actor_Original"})

    def test_audio_diagnostics_do_not_retain_personal_file_paths(self):
        result = sanitize_diagnostics({"errors": ["Missing samples in /Users/example/private"], "warnings": ["Encoder input /var/folders/example/input.wav"], "clips": []})
        self.assertEqual(result["errors"], ["Missing samples in <local path>"])
        self.assertEqual(result["warnings"], ["Encoder input <local path>"])


if __name__ == "__main__":
    unittest.main()
