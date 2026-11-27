import type { SFSymbol } from 'expo-symbols';
import type { MaterialSymbolName } from './materialSymbols.generated';

/**
 * The SF Symbol iOS draws for each Material Symbol name (Visual 2026 D-DV11's other half, step V9).
 *
 * Call sites keep naming Material Symbols, the one vocabulary both platforms share; Android draws that
 * name from the bundled font (`iconFont.ts`) and iOS draws the symbol below. The table is checked
 * twice by the compiler:
 * - `Record<MaterialSymbolName, …>`: a Material name added to the generated set with no SF twin is a
 *   typecheck error, so iOS never falls back silently;
 * - `SFSymbol` is Apple's own name list (sf-symbols-typescript): a misspelt symbol is an error too.
 *
 * `fill` is the filled cut for `<Icon fill>` (a selected or affirmative state); where SF has no filled
 * form the outline serves both. Chosen for meaning, not letter: `local_shipping` is a truck,
 * `fmd_bad` an exclamation pin, `oil_barrel` a fuel drop (SF has no barrel).
 */
export interface SfGlyph {
  sf: SFSymbol;
  fill?: SFSymbol;
}

export const SF_SYMBOLS: Record<MaterialSymbolName, SfGlyph> = {
  account_circle: { sf: 'person.crop.circle', fill: 'person.crop.circle.fill' },
  add: { sf: 'plus' },
  add_a_photo: { sf: 'camera.badge.ellipsis', fill: 'camera.fill' },
  arrow_back: { sf: 'chevron.backward' },
  arrow_forward: { sf: 'arrow.forward' },
  attach_money: { sf: 'dollarsign' },
  badge: { sf: 'person.text.rectangle', fill: 'person.text.rectangle.fill' },
  bolt: { sf: 'bolt', fill: 'bolt.fill' },
  calendar_today: { sf: 'calendar' },
  call: { sf: 'phone', fill: 'phone.fill' },
  cancel: { sf: 'xmark.circle', fill: 'xmark.circle.fill' },
  check: { sf: 'checkmark' },
  check_box: { sf: 'checkmark.square', fill: 'checkmark.square.fill' },
  check_box_outline_blank: { sf: 'square' },
  check_circle: { sf: 'checkmark.circle', fill: 'checkmark.circle.fill' },
  chevron_left: { sf: 'chevron.left' },
  chevron_right: { sf: 'chevron.right' },
  close: { sf: 'xmark' },
  cloud_done: { sf: 'checkmark.icloud', fill: 'checkmark.icloud.fill' },
  cloud_off: { sf: 'icloud.slash', fill: 'icloud.slash.fill' },
  cloud_sync: { sf: 'arrow.triangle.2.circlepath.icloud', fill: 'arrow.triangle.2.circlepath.icloud.fill' },
  content_copy: { sf: 'doc.on.doc', fill: 'doc.on.doc.fill' },
  credit_card: { sf: 'creditcard', fill: 'creditcard.fill' },
  dangerous: { sf: 'xmark.octagon', fill: 'xmark.octagon.fill' },
  dark_mode: { sf: 'moon', fill: 'moon.fill' },
  delete: { sf: 'trash', fill: 'trash.fill' },
  directions: { sf: 'arrow.triangle.turn.up.right.diamond', fill: 'arrow.triangle.turn.up.right.diamond.fill' },
  do_not_disturb_on: { sf: 'minus.circle', fill: 'minus.circle.fill' },
  done: { sf: 'checkmark' },
  download: { sf: 'arrow.down.to.line' },
  edit: { sf: 'pencil' },
  error: { sf: 'exclamationmark.circle', fill: 'exclamationmark.circle.fill' },
  ev_station: { sf: 'ev.charger', fill: 'ev.charger.fill' },
  event: { sf: 'calendar.badge.clock' },
  expand_less: { sf: 'chevron.up' },
  expand_more: { sf: 'chevron.down' },
  explore: { sf: 'safari', fill: 'safari.fill' },
  filter_list: { sf: 'line.3.horizontal.decrease' },
  flash_on: { sf: 'bolt', fill: 'bolt.fill' },
  fmd_bad: { sf: 'mappin.and.ellipse' },
  health_and_safety: { sf: 'cross.case', fill: 'cross.case.fill' },
  help: { sf: 'questionmark.circle', fill: 'questionmark.circle.fill' },
  history: { sf: 'clock.arrow.circlepath' },
  home: { sf: 'house', fill: 'house.fill' },
  hourglass_empty: { sf: 'hourglass' },
  image: { sf: 'photo', fill: 'photo.fill' },
  info: { sf: 'info.circle', fill: 'info.circle.fill' },
  keyboard_arrow_down: { sf: 'chevron.down' },
  keyboard_arrow_up: { sf: 'chevron.up' },
  light_mode: { sf: 'sun.max', fill: 'sun.max.fill' },
  local_fire_department: { sf: 'flame', fill: 'flame.fill' },
  local_gas_station: { sf: 'fuelpump', fill: 'fuelpump.fill' },
  local_shipping: { sf: 'truck.box', fill: 'truck.box.fill' },
  lock: { sf: 'lock', fill: 'lock.fill' },
  lock_open: { sf: 'lock.open', fill: 'lock.open.fill' },
  login: { sf: 'rectangle.portrait.and.arrow.right' },
  logout: { sf: 'rectangle.portrait.and.arrow.forward' },
  mail: { sf: 'envelope', fill: 'envelope.fill' },
  map: { sf: 'map', fill: 'map.fill' },
  menu: { sf: 'line.3.horizontal' },
  military_tech: { sf: 'medal', fill: 'medal.fill' },
  more_horiz: { sf: 'ellipsis' },
  more_vert: { sf: 'ellipsis' },
  my_location: { sf: 'location', fill: 'location.fill' },
  navigation: { sf: 'location.north', fill: 'location.north.fill' },
  north: { sf: 'arrow.up' },
  notifications: { sf: 'bell', fill: 'bell.fill' },
  notifications_active: { sf: 'bell.badge', fill: 'bell.badge.fill' },
  oil_barrel: { sf: 'drop', fill: 'drop.fill' },
  open_in_new: { sf: 'arrow.up.right.square', fill: 'arrow.up.right.square.fill' },
  payments: { sf: 'banknote', fill: 'banknote.fill' },
  pending: { sf: 'clock', fill: 'clock.fill' },
  person: { sf: 'person', fill: 'person.fill' },
  photo_camera: { sf: 'camera', fill: 'camera.fill' },
  pin_drop: { sf: 'mappin.and.ellipse' },
  place: { sf: 'mappin', fill: 'mappin.circle.fill' },
  play_arrow: { sf: 'play', fill: 'play.fill' },
  play_circle: { sf: 'play.circle', fill: 'play.circle.fill' },
  priority_high: { sf: 'exclamationmark' },
  qr_code_scanner: { sf: 'qrcode.viewfinder' },
  quiz: { sf: 'questionmark.bubble', fill: 'questionmark.bubble.fill' },
  radio_button_checked: { sf: 'smallcircle.filled.circle', fill: 'smallcircle.filled.circle.fill' },
  radio_button_unchecked: { sf: 'circle' },
  refresh: { sf: 'arrow.clockwise' },
  remove: { sf: 'minus' },
  report: { sf: 'exclamationmark.octagon', fill: 'exclamationmark.octagon.fill' },
  route: { sf: 'point.topleft.down.to.point.bottomright.curvepath', fill: 'point.topleft.down.to.point.bottomright.curvepath.fill' },
  schedule: { sf: 'clock', fill: 'clock.fill' },
  school: { sf: 'graduationcap', fill: 'graduationcap.fill' },
  science: { sf: 'flask', fill: 'flask.fill' },
  search: { sf: 'magnifyingglass' },
  settings: { sf: 'gearshape', fill: 'gearshape.fill' },
  shield: { sf: 'shield', fill: 'shield.fill' },
  signal_cellular_off: { sf: 'antenna.radiowaves.left.and.right.slash' },
  south: { sf: 'arrow.down' },
  speed: { sf: 'gauge.with.dots.needle.67percent' },
  star: { sf: 'star', fill: 'star.fill' },
  sync: { sf: 'arrow.triangle.2.circlepath' },
  sync_problem: { sf: 'exclamationmark.arrow.triangle.2.circlepath' },
  task_alt: { sf: 'checkmark.circle', fill: 'checkmark.circle.fill' },
  trending_down: { sf: 'chart.line.downtrend.xyaxis' },
  trending_up: { sf: 'chart.line.uptrend.xyaxis' },
  upload: { sf: 'arrow.up.to.line' },
  verified: { sf: 'checkmark.seal', fill: 'checkmark.seal.fill' },
  verified_user: { sf: 'checkmark.shield', fill: 'checkmark.shield.fill' },
  visibility: { sf: 'eye', fill: 'eye.fill' },
  visibility_off: { sf: 'eye.slash', fill: 'eye.slash.fill' },
  warning: { sf: 'exclamationmark.triangle', fill: 'exclamationmark.triangle.fill' },
  water_drop: { sf: 'drop', fill: 'drop.fill' },
  wifi: { sf: 'wifi' },
  wifi_off: { sf: 'wifi.slash' },
  workspace_premium: { sf: 'rosette' },
};

/** The SF Symbol for a Material name and cut. */
export function sfGlyph(name: MaterialSymbolName, fill: boolean): SFSymbol {
  const glyph = SF_SYMBOLS[name];
  return fill ? (glyph.fill ?? glyph.sf) : glyph.sf;
}
