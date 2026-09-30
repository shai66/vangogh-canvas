// The icons Canvas uses, from Phosphor Icons (MIT). Each is the inside of an
// <svg> with a 256 by 256 view box, drawn in the current text colour.

import airplaneTiltSvg from '@phosphor-icons/core/regular/airplane-tilt.svg?raw';
import binocularsSvg from '@phosphor-icons/core/regular/binoculars.svg?raw';
import boxingGloveSvg from '@phosphor-icons/core/regular/boxing-glove.svg?raw';
import campfireSvg from '@phosphor-icons/core/regular/campfire.svg?raw';
import cardsSvg from '@phosphor-icons/core/regular/cards.svg?raw';
import castleTurretSvg from '@phosphor-icons/core/regular/castle-turret.svg?raw';
import chartLineUpSvg from '@phosphor-icons/core/regular/chart-line-up.svg?raw';
import checkSvg from '@phosphor-icons/core/regular/check.svg?raw';
import citySvg from '@phosphor-icons/core/regular/city.svg?raw';
import closeSvg from '@phosphor-icons/core/regular/x.svg?raw';
import compassSvg from '@phosphor-icons/core/regular/compass.svg?raw';
import coopSvg from '@phosphor-icons/core/fill/handshake-fill.svg?raw';
import crosshairSvg from '@phosphor-icons/core/regular/crosshair.svg?raw';
import cursorClickSvg from '@phosphor-icons/core/regular/cursor-click.svg?raw';
import desktopSvg from '@phosphor-icons/core/regular/desktop.svg?raw';
import detectiveSvg from '@phosphor-icons/core/regular/detective.svg?raw';
import downSvg from '@phosphor-icons/core/regular/caret-down.svg?raw';
import downloadSvg from '@phosphor-icons/core/regular/download-simple.svg?raw';
import eyeSlashSvg from '@phosphor-icons/core/regular/eye-slash.svg?raw';
import eyeSvg from '@phosphor-icons/core/regular/eye.svg?raw';
import filterSvg from '@phosphor-icons/core/regular/funnel.svg?raw';
import flagCheckeredSvg from '@phosphor-icons/core/regular/flag-checkered.svg?raw';
import ghostSvg from '@phosphor-icons/core/regular/ghost.svg?raw';
import globeHemisphereWestSvg from '@phosphor-icons/core/regular/globe-hemisphere-west.svg?raw';
import hammerSvg from '@phosphor-icons/core/regular/hammer.svg?raw';
import handFistSvg from '@phosphor-icons/core/regular/hand-fist.svg?raw';
import hourglassMediumSvg from '@phosphor-icons/core/regular/hourglass-medium.svg?raw';
import infoSvg from '@phosphor-icons/core/regular/info.svg?raw';
import joystickSvg from '@phosphor-icons/core/regular/joystick.svg?raw';
import leftSvg from '@phosphor-icons/core/regular/caret-left.svg?raw';
import lightningSvg from '@phosphor-icons/core/regular/lightning.svg?raw';
import linuxSvg from '@phosphor-icons/core/fill/linux-logo-fill.svg?raw';
import macosSvg from '@phosphor-icons/core/fill/apple-logo-fill.svg?raw';
import magicWandSvg from '@phosphor-icons/core/regular/magic-wand.svg?raw';
import mapTrifoldSvg from '@phosphor-icons/core/regular/map-trifold.svg?raw';
import multiplayerSvg from '@phosphor-icons/core/fill/users-three-fill.svg?raw';
import planetSvg from '@phosphor-icons/core/regular/planet.svg?raw';
import puzzlePieceSvg from '@phosphor-icons/core/regular/puzzle-piece.svg?raw';
import rightSvg from '@phosphor-icons/core/regular/caret-right.svg?raw';
import runSvg from '@phosphor-icons/core/fill/play-circle-fill.svg?raw';
import searchSvg from '@phosphor-icons/core/regular/magnifying-glass.svg?raw';
import shieldChevronSvg from '@phosphor-icons/core/regular/shield-chevron.svg?raw';
import skullSvg from '@phosphor-icons/core/regular/skull.svg?raw';
import stairsSvg from '@phosphor-icons/core/regular/stairs.svg?raw';
import steeringWheelSvg from '@phosphor-icons/core/regular/steering-wheel.svg?raw';
import strategySvg from '@phosphor-icons/core/regular/strategy.svg?raw';
import swordSvg from '@phosphor-icons/core/regular/sword.svg?raw';
import timerSvg from '@phosphor-icons/core/regular/timer.svg?raw';
import userFocusSvg from '@phosphor-icons/core/regular/user-focus.svg?raw';
import warningSvg from '@phosphor-icons/core/fill/warning-fill.svg?raw';
import windowsSvg from '@phosphor-icons/core/fill/windows-logo-fill.svg?raw';

/** What is between <svg> and </svg>. */
function inner(svg: string): string {
	return svg.replace(/^[^]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

export const ICONS = {
	search: inner(searchSvg),
	close: inner(closeSvg),
	filter: inner(filterSvg),
	download: inner(downloadSvg),
	left: inner(leftSvg),
	right: inner(rightSvg),
	down: inner(downSvg),
	check: inner(checkSvg),
	info: inner(infoSvg),
	desktop: inner(desktopSvg),
	windows: inner(windowsSvg),
	macos: inner(macosSvg),
	linux: inner(linuxSvg),
	warning: inner(warningSvg),
	multiplayer: inner(multiplayerSvg),
	coop: inner(coopSvg),
	run: inner(runSvg),
	lightning: inner(lightningSvg),
	compass: inner(compassSvg),
	joystick: inner(joystickSvg),
	hammer: inner(hammerSvg),
	cards: inner(cardsSvg),
	boxingGlove: inner(boxingGloveSvg),
	detective: inner(detectiveSvg),
	binoculars: inner(binocularsSvg),
	mapTrifold: inner(mapTrifoldSvg),
	magicWand: inner(magicWandSvg),
	handFist: inner(handFistSvg),
	eye: inner(eyeSvg),
	castleTurret: inner(castleTurretSvg),
	ghost: inner(ghostSvg),
	chartLineUp: inner(chartLineUpSvg),
	city: inner(citySvg),
	globeHemisphereWest: inner(globeHemisphereWestSvg),
	stairs: inner(stairsSvg),
	cursorClick: inner(cursorClickSvg),
	puzzlePiece: inner(puzzlePieceSvg),
	flagCheckered: inner(flagCheckeredSvg),
	steeringWheel: inner(steeringWheelSvg),
	timer: inner(timerSvg),
	skull: inner(skullSvg),
	sword: inner(swordSvg),
	planet: inner(planetSvg),
	crosshair: inner(crosshairSvg),
	airplaneTilt: inner(airplaneTiltSvg),
	eyeSlash: inner(eyeSlashSvg),
	strategy: inner(strategySvg),
	campfire: inner(campfireSvg),
	shieldChevron: inner(shieldChevronSvg),
	userFocus: inner(userFocusSvg),
	hourglassMedium: inner(hourglassMediumSvg)
} as const;

export type IconName = keyof typeof ICONS;

/** The icon of a genre, by the name GOG gives the genre. A genre without one shows its name only. */
const GENRE_ICON = new Map<string, IconName>([
	['Action', 'lightning'],
	['Adventure', 'compass'],
	['Arcade', 'joystick'],
	['Building', 'hammer'],
	['Card Game', 'cards'],
	['Combat', 'boxingGlove'],
	['Detective-mystery', 'detective'],
	['Espionage', 'binoculars'],
	['Exploration', 'mapTrifold'],
	['Fantasy', 'magicWand'],
	['Fighting', 'handFist'],
	['FPP', 'eye'],
	['Historical', 'castleTurret'],
	['Horror', 'ghost'],
	['Managerial', 'chartLineUp'],
	['Modern', 'city'],
	['Open World', 'globeHemisphereWest'],
	['Platformer', 'stairs'],
	['Point-and-click', 'cursorClick'],
	['Puzzle', 'puzzlePiece'],
	['Racing', 'flagCheckered'],
	['Rally', 'steeringWheel'],
	['Real-time', 'timer'],
	['Roguelike', 'skull'],
	['Role-playing', 'sword'],
	['Sci-fi', 'planet'],
	['Shooter', 'crosshair'],
	['Simulation', 'airplaneTilt'],
	['Stealth', 'eyeSlash'],
	['Strategy', 'strategy'],
	['Survival', 'campfire'],
	['Tactical', 'shieldChevron'],
	['TPP', 'userFocus'],
	['Turn-based', 'hourglassMedium']
]);

export function genreIcon(genre: string): IconName | null {
	return GENRE_ICON.get(genre) ?? null;
}
