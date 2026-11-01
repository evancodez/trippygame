// The five worlds. Coordinates are tiles, y up, y = 0 is the bottom of the level.
// Reach (see PHYS in game.js): a full jump rises ~3.8 tiles and carries ~6.5 tiles at a run,
// a dash adds ~3.6 tiles in any direction, wall-jumps climb shafts 3 tiles wide.
import { LevelBuilder, T } from './level.js';

const SILK = {
  id: 'silk', name: 'Silk', subtitle: 'I · learning to move', theme: 0, energy: 0.35,
  build() {
    const L = new LevelBuilder(134, 24);
    // the start: a few steps
    L.ground(0, 22, 3).start(2, 3);
    L.hint(0, 'Move with ← → / A D (or the left stick) · Jump with Space / ✕');
    L.orbs(5, 3, 4);
    L.rect(10, 3, 12, 3).orbs(10, 4, 3);
    L.rect(15, 3, 17, 4).orbs(15, 5, 3);
    // first gap
    L.orbArc(20, 5, 7, 7, 2.2);
    L.ground(27, 43, 3);
    L.hint(29, 'Hold jump to jump higher · tap it for a hop');
    L.ledge(31, 34, 5).orbs(31, 6, 4);
    L.prism(37, 10);
    // the wall-jump shaft: walk under the pillar, then climb between it and the big block
    L.rect(40, 5, 40, 12);
    L.rect(44, 0, 48, 12);
    L.hint(38, 'Jump into a wall, then jump again to bounce off it');
    L.orbs(42, 6, 4, 0, 2);
    L.prism(40, 13.4);
    L.checkpoint(46, 13);
    // the dash gap
    L.hint(45, 'Dash: Shift / X (or □) — any direction, once per jump. Jump, then dash across!');
    L.orbs(50, 15, 6);
    L.rect(56, 0, 66, 12);
    L.rect(67, 0, 70, 8);
    // risers: drawings on the wall that rise into pillars as you come near, over a bed of spikes
    L.ground(67, 92, 3);
    L.spikes(71, 84, 3);
    L.hint(64, 'Some shapes are only drawings… until you come close');
    for (const [x, top] of [[73, 6], [76, 7], [79, 8], [82, 7]]) { L.rect(x, 3, x, top - 1, T.RISER); L.orb(x, top); }
    // the hand
    L.checkpoint(87, 3);
    L.clear(93, 0, 98, 2);
    L.ground(85, 92, 3);
    L.hand(94, 1, 8, 5);
    L.hint(86, 'Ride the hand');
    L.rect(99, 0, 133, 9);
    L.orbs(101, 10, 5);
    // an up-dash for the last prism, then the vortex
    L.hint(112, 'Jump, then dash upward (↑ + dash)');
    L.prism(117, 16.5);
    L.orbs(115, 12, 5, 1, 1);
    L.goal(127, 10);
    return L;
  },
};

const MOIRE = {
  id: 'moire', name: 'Moiré', subtitle: 'II · the lens', theme: 1, energy: 0.5, lens: true,
  build() {
    const L = new LevelBuilder(150, 26);
    L.ground(0, 15, 4).start(2, 4);
    L.hint(0, 'Hold the mouse button (or L2 / R2) to open the Lens — it makes ghost blocks real');
    // a ghost bridge over the void
    L.rect(16, 3, 27, 3, T.GHOST);
    L.orbs(17, 5, 10);
    L.prism(21, 9.5);
    L.ground(28, 30, 4).checkpoint(29, 4);
    // ghost stairs up to the high ledge — aim the lens with the mouse / right stick
    L.hint(27, 'Aim the lens with the mouse (or the right stick) to reveal the steps ahead');
    L.rect(31, 5, 33, 5, T.GHOST).rect(35, 7, 37, 7, T.GHOST).rect(39, 9, 41, 9, T.GHOST).rect(43, 11, 45, 11, T.GHOST);
    L.orbs(32, 7, 2).orbs(36, 9, 2).orbs(40, 11, 2);
    L.ground(28, 30, 4);
    L.rect(46, 0, 60, 11);
    L.checkpoint(48, 12);
    L.hint(50, 'Eyes are deadly — but a dash goes straight through them');
    L.watcher(55, 12.6, 2.5, 0, 3);
    L.orbs(52, 14, 4);
    // ghost islands over spikes
    L.ground(61, 90, 2);
    L.spikes(61, 90, 2);
    L.rect(63, 6, 65, 6, T.GHOST).rect(69, 7, 71, 7, T.GHOST).rect(75, 6, 77, 6, T.GHOST).rect(81, 8, 83, 8, T.GHOST).rect(87, 7, 89, 7, T.GHOST);
    L.orbs(64, 8, 2).orbs(70, 9, 2).orbs(76, 8, 2).orbs(82, 10, 2);
    L.watcher(79, 10.5, 0, 2, 2.6);
    // a climb: wall-jump between real stone (left) and a ghost wall (right)
    L.rect(91, 0, 104, 7);
    L.checkpoint(92, 8);
    L.rect(95, 10, 97, 19);
    L.rect(101, 9, 101, 18, T.GHOST);
    L.hint(93, 'Wall-jump up the shaft — keep the lens on the ghost wall');
    L.orbs(99, 10, 5, 0, 2);
    L.prism(96, 20.6);
    L.rect(101, 19, 114, 19);
    L.orbs(104, 20, 6);
    // down to the vortex
    L.ground(115, 149, 8);
    L.watcher(124, 10.2, 2, 0, 2.2);
    L.watcher(131, 11, 0, 1.5, 1.8, 0.5);
    L.rect(126, 13, 128, 13, T.GHOST);
    L.prism(127, 16);
    L.orbs(119, 9, 4);
    L.goal(142, 8);
    return L;
  },
};

const FIGURE = {
  id: 'figure', name: 'Figure / Ground', subtitle: 'III · the flip', theme: 2, energy: 0.6, flip: true,
  build() {
    const L = new LevelBuilder(150, 26);
    const A = T.FLIP_A, B = T.FLIP_B;
    L.ground(0, 14, 4).start(2, 4);
    L.hint(0, 'Flip the world with E / C (or △, L1, R1): ink becomes paper, paper becomes ink');
    // an ink wall; flip it away and a paper bridge appears
    L.rect(12, 4, 13, 9, A);
    L.rect(15, 3, 24, 3, B);
    L.orbs(16, 5, 8);
    L.ground(25, 40, 4);
    // alternating platforms over the void: flip in mid-air
    L.hint(27, 'Flip in mid-air to land on the other world');
    L.rect(42, 5, 45, 5, A).rect(49, 7, 52, 7, B).rect(56, 5, 59, 5, A).rect(63, 7, 66, 7, B);
    L.orbs(43, 7, 3).orbs(50, 9, 3).orbs(57, 7, 3).orbs(64, 9, 3);
    L.prism(54, 12);
    L.ground(70, 82, 6);
    L.checkpoint(71, 6);
    // a climb of alternating ledges
    L.hint(76, 'Climb: jump, flip, jump, flip…');
    L.rect(78, 8, 80, 8, A).rect(82, 11, 84, 11, B).rect(78, 14, 80, 14, A).rect(82, 17, 85, 17, B);
    L.rect(86, 0, 100, 17);
    L.orbs(79, 10, 2).orbs(83, 13, 2).orbs(79, 16, 2).orbs(83, 19, 2);
    L.prism(79, 21);
    L.watcher(93, 19.6, 3, 0, 3.2);
    L.checkpoint(98, 18);
    // the flip corridor: walls of both worlds, a ceiling so you can't jump over them
    L.ground(101, 124, 6);
    L.rect(103, 12, 124, 13);
    L.rect(105, 6, 105, 11, A).rect(109, 6, 109, 11, B).rect(113, 6, 113, 11, A).rect(117, 6, 117, 11, B).rect(121, 6, 121, 11, A);
    L.orbs(106, 7, 2).orbs(110, 7, 2).orbs(114, 7, 2).orbs(118, 7, 2);
    // last stretch: crumbling stones and the vortex
    L.rect(125, 5, 131, 5, T.CRUMBLE);
    L.hint(124, 'Cracked stones don’t wait');
    L.rect(132, 6, 135, 6, B);
    L.prism(133, 9);
    L.ground(137, 149, 7);
    L.goal(144, 7);
    return L;
  },
};

const TUNNEL = {
  id: 'tunnel', name: 'Tunnel', subtitle: 'IV · bounce, ride, crumble', theme: 3, energy: 0.75, lens: true, flip: true,
  build() {
    const L = new LevelBuilder(172, 28);
    L.ground(0, 14, 4).start(2, 4);
    L.hint(0, 'Domes bounce you high — no need to hold jump');
    L.dome(10, 4, 1.12);
    L.rect(14, 0, 22, 9);
    L.orbs(10, 7, 1, 0).orbs(10, 9, 1);
    // dome chain over spikes
    L.ground(23, 40, 1).spikes(23, 40, 1);
    L.rect(27, 0, 28, 5).dome(27, 6);
    L.rect(33, 0, 34, 5).dome(33, 6);
    L.orbs(27, 10, 1).orbs(30, 12, 1).orbs(33, 10, 1).orbs(36, 12, 1);
    L.prism(30, 15.5);
    L.rect(39, 0, 46, 9);
    L.checkpoint(41, 10);
    // moving bars over the void
    L.hint(44, 'Moving bars carry you');
    L.mover(48, 9, 7, 4.2);
    L.mover(60, 11, 6, 3.6, 0.5);
    L.orbs(52, 11, 4).orbs(63, 13, 3);
    L.rect(70, 0, 80, 10);
    L.checkpoint(72, 11);
    // a crumbling run with an eye at the end
    L.rect(81, 10, 95, 10, T.CRUMBLE);
    L.orbs(83, 12, 12);
    L.watcher(98, 12.5, 0, 1.2, 1.6);
    L.rect(96, 0, 104, 10);
    L.prism(89, 16);
    // the hand elevator
    L.hint(103, 'Hop from hand to hand');
    L.hand(106, 3, 7, 4.2, 0);
    L.hand(111, 5, 7, 4.2, 0.5);
    L.hand(116, 3, 8, 4.2, 0);
    L.hand(121, 6, 7, 4.2, 0.5);
    L.orbs(112, 14, 1).orbs(117, 13, 1).orbs(122, 15, 1);
    L.rect(125, 0, 136, 12);
    L.checkpoint(127, 13);
    // the finale: a ghost bridge, then flip walls
    L.rect(137, 12, 146, 12, T.GHOST);
    L.orbs(138, 14, 8);
    L.prism(141, 18);
    L.rect(147, 0, 171, 12);
    L.rect(152, 13, 152, 18, T.FLIP_A).rect(156, 13, 156, 18, T.FLIP_B);
    L.rect(150, 19, 159, 20);
    L.goal(165, 13);
    return L;
  },
};

const BLOOM = {
  id: 'bloom', name: 'Bloom', subtitle: 'V · run from the static', theme: 4, energy: 1, lens: true, flip: true,
  chase: { trigger: 12, speed: 6.4, gap: 13 },
  build() {
    const L = new LevelBuilder(204, 26);
    L.ground(0, 17, 4).start(2, 4);
    L.hint(0, 'The static is coming. Run.');
    L.ground(21, 24, 4).ground(28, 32, 4);
    L.orbArc(17, 5, 4, 4, 1.5).orbArc(24, 5, 4, 4, 1.5);
    // risers climb out of the floor as you run at them
    L.ground(33, 40, 4);
    for (const [x, top] of [[35, 6], [37, 8], [39, 10]]) { L.rect(x, 4, x, top - 1, T.RISER); L.orb(x, top); }
    L.rect(40, 0, 54, 9);
    L.checkpoint(43, 10);
    // flip: a wall of ink, a bridge of paper
    L.rect(48, 10, 49, 15, T.FLIP_A).rect(46, 16, 52, 16);
    L.rect(55, 9, 64, 9, T.FLIP_B);
    L.orbs(56, 11, 8);
    L.rect(65, 0, 74, 9);
    // dome pit
    L.ground(75, 92, 1).spikes(75, 92, 1);
    L.rect(78, 0, 79, 5).dome(78, 6);
    L.rect(85, 0, 86, 5).dome(85, 6);
    L.orbs(81, 13, 2).orbs(87, 13, 2);
    L.prism(82, 16);
    L.rect(92, 0, 104, 9);
    L.checkpoint(94, 10);
    // ghost bridge with an eye above it
    L.rect(105, 9, 120, 9, T.GHOST);
    L.watcher(112, 12, 2, 0, 1.6);
    L.prism(116, 14.5);
    L.orbs(106, 11, 14);
    // crumbling run down to a ledge
    L.rect(121, 9, 133, 9, T.CRUMBLE);
    L.ground(134, 150, 8);
    L.checkpoint(146, 8);
    // fast hands
    L.hand(152, 3, 6, 2.4, 0);
    L.hand(158, 5, 6, 2.4, 0.5);
    L.orbs(153, 12, 1).orbs(159, 14, 1);
    L.prism(156, 17);
    L.rect(163, 0, 203, 11);
    L.orbs(166, 13, 10);
    L.goal(192, 12);
    return L;
  },
};

export const LEVELS = [SILK, MOIRE, FIGURE, TUNNEL, BLOOM];
