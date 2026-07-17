const fs = require('fs');
const lines = fs.readFileSync('src/game/skills/SkillSystem.ts', 'utf-8').split('\n');

lines[43] = "      battle.applyDamage(e, 120, caster, false, false, true);";
lines[76] = "        battle.applyDamage(e, 570, caster, false, false, true);";
lines[154] = "            battle.applyDamage(target, caster.atk * 3, caster, false, false, true);";
lines[275] = "              battle.applyDamage(target, caster.atk * 13, caster, false, false, true);";
lines[408] = "        battle.applyDamage(e, caster.atk * 2, caster, false, false, true);";
lines[427] = "        battle.applyDamage(target, Math.round(caster.atk * 1.5), caster, false, false, true);";
lines[522] = "            battle.applyDamage(targetEnemy, caster.atk + 12, caster, false, false, true);";
lines[586] = "          battle.applyDamage(enemy, 80, caster, false, false, true);";
lines[704] = "        battle.applyDamage(target, 192, caster, false, false, true);";
lines[777] = "      battle.applyDamage(target, caster.atk * 3, caster, false, false, true);";
lines[853] = "    battle.applyDamage(target, 207, caster, false, false, true);";
lines[925] = "        battle.applyDamage(e, caster.atk * 2, caster, false, false, true);";

fs.writeFileSync('src/game/skills/SkillSystem.ts', lines.join('\n'));
