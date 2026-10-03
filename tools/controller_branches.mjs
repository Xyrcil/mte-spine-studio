export function cardOutcomeSeeds(draw){
  const seeds=new Map();for(let seed=1;seed<=100000&&seeds.size<3;seed++){const outcome=draw(seed);if(!Number.isInteger(outcome)||outcome<0||outcome>2)throw new Error('Invalid card outcome');if(!seeds.has(outcome))seeds.set(outcome,seed);}
  if(seeds.size!==3)throw new Error('Card outcome coverage is incomplete');return [0,1,2].map(outcome=>({outcome,seed:seeds.get(outcome)}));
}
