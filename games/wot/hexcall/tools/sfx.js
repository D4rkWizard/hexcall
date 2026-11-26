// Sound effect categories beyond the commander voice. Each category replaces every
// sound of the listed Wwise events (event names come from scripts/item_defs).
// [file key, label, when, recording hint, bank, events]
const sizes = ['automatic', 'small', 'meduim', 'main', 'main_dual', 'main_extra', 'main_extra_dual',
  'large', 'large_dual', 'large_extra', 'huge'];
const engines = ['v55', 'mtu_mb_838', 'Hetzer', 'gaz_aa', 'Continental_R975', 'v2k', 'ContinentalR', 'Ford_GAA',
  'patria', 'cadillac_series_42', 'brdm_2', 'gte', 'leyland_l60', 'ContinentalR_STRV'];

module.exports = [
  ['kanone_eigen', 'Kanone (dein Panzer)', 'Dein Schuss', 'Kurzer, kräftiger Knall, z. B. „Bumm!“ oder Klatschen ins Mikro (0,5–2 s)',
    'wpn.bnk', sizes.map((s) => `wpn_${s}_PC`)],
  ['kanone_gegner', 'Kanone (andere Panzer)', 'Schüsse von Gegnern und Verbündeten', 'Wie oben, gern etwas dumpfer',
    'wpn.bnk', sizes.map((s) => `wpn_${s}_NPC`)],
  ['autokanone_eigen', 'Schnellfeuerkanone (dein Panzer)', 'Schüsse von Autokanonen', 'Sehr kurzer Knall (unter 0,3 s), wird schnell wiederholt',
    'fast_guns.bnk', ['psb_auto_shoot_PC', 'psb_auto_shoot_85_107_PC']],
  ['autokanone_gegner', 'Schnellfeuerkanone (andere)', 'Autokanonen anderer Panzer', 'Sehr kurzer Knall',
    'fast_guns.bnk', ['psb_auto_shoot_NPC', 'psb_auto_shoot_85_107_NPC']],
  ['motor_eigen', 'Motor (dein Panzer)', 'Motorgeräusch, läuft in Schleife', 'Gleichmäßiges Brummen ohne Anfang/Ende, 2–4 s. Die Tonhöhe ändert das Spiel selbst',
    'engines.bnk', engines.map((e) => `eng_${e}_pc`)],
  ['motor_gegner', 'Motor (andere Panzer)', 'Motoren anderer Panzer', 'Gleichmäßiges Brummen, 2–4 s',
    'engines.bnk', engines.map((e) => `eng_${e}_npc`)],
  ['turm', 'Turm drehen', 'Während der Turm sich dreht (Schleife)', 'Gleichmäßiges Surren, 1–3 s',
    'turret.bnk', ['tur_mech_trav', ...[1, 2, 3, 4, 5, 6, 7].map((i) => `tur_man_trav_0${i}`)]],
  ['ketten', 'Ketten / Fahrwerk', 'Rasseln der Ketten beim Fahren (Schleife)', 'Rasseln oder Klappern, 2–3 s',
    'treads_pc.bnk', ['treads_type_pc', 'trds_t34_pc', 'trds_yoh_pc', 'wheels_suspension_pc']],
  ['einschlag_he', 'HE-Einschlag', 'Explosion von Sprenggranaten in der Nähe', 'Dumpfer Knall, 1–2 s',
    'impacts_full.bnk', ['small', 'medium', 'main', 'large', 'huge'].map((s) => `imp_${s}_splash_HE_NPC_PC`)
      .concat(['main', 'large', 'huge'].map((s) => `imp_artillery_splash_${s}_NPC_PC`))],
  ['munitionsexplosion', 'Munitionsexplosion', 'Ein Panzer fliegt in die Luft (Munition/Treibstoff)', 'Großer Knall, 1–3 s',
    'expl.bnk', ['expl_ammo_PC', 'expl_ammo_NPC', 'expl_fuel_PC', 'expl_fuel_NPC', 'expl_burnup_ammo_PC', 'expl_burnup_ammo_NPC']],
  ['zerstoert', 'Panzer zerstört', 'Ein Panzer wird zerstört (ohne Explosion)', 'Krachen, Ächzen, 1–2 s',
    'expl.bnk', ['s', 'm', 'l'].flatMap((s) => [`expl_crew_death_${s}_PC`, `expl_crew_death_${s}_NPC`])
      .concat(['expl_ram_death_PC', 'expl_ram_death_NPC'])],
  ['feuer', 'Feuer am Panzer', 'Ein Panzer brennt (Schleife)', 'Knistern, Rauschen, 2–3 s',
    'damage.bnk', ['small', 'medium', 'large'].flatMap((s) => [`burning_tank_${s}`, `flaming_engine_${s}_pc`, `flaming_engine_${s}_npc`])],
];
