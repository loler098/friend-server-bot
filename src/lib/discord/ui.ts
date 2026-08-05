/** Discord Components V2 helpers. */

export const IS_COMPONENTS_V2 = 1 << 15; // 32768
export const EPHEMERAL = 64;

export const COLORS = {
  win: 0x2ecc71,
  loss: 0xed4245,
  neutral: 0x5865f2,
  gold: 0xf1c40f,
  info: 0x9b59b6,
  dark: 0x2b2d31,
  rain: 0x3498db,
} as const;

export type Component = Record<string, unknown>;

export function text(content: string): Component {
  return { type: 10, content };
}

export function separator(spacing: 1 | 2 = 1, divider = true): Component {
  return { type: 14, divider, spacing };
}

export type ButtonSpec = {
  label?: string;
  style?: 1 | 2 | 3 | 4 | 5;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
  disabled?: boolean;
};

export function button(spec: ButtonSpec): Component {
  const { style = 2, ...rest } = spec;
  return { type: 2, style: spec.url ? 5 : style, ...rest };
}

export function row(...buttons: Component[]): Component {
  return { type: 1, components: buttons };
}

export function section(body: string[], accessory: Component): Component {
  return { type: 9, components: body.map(text), accessory };
}

export function container(accent: number, components: Component[]): Component {
  return { type: 17, accent_color: accent, components };
}

/** Renders a compact aligned stat block. */
export function stats(pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `> **${k}** · ${v}`).join("\n");
}

export function title(emoji: string, label: string, subtitle?: string): Component {
  return text(`## ${emoji} ${label}${subtitle ? `\n-# ${subtitle}` : ""}`);
}

/* ------------------------------ Responses ------------------------------ */

export type V2Payload = { flags: number; components: Component[] };

export function payload(components: Component[], ephemeral = false): V2Payload {
  return {
    flags: IS_COMPONENTS_V2 | (ephemeral ? EPHEMERAL : 0),
    components,
  };
}

/** New message response (type 4). */
export function v2Reply(components: Component[], ephemeral = false) {
  return Response.json({ type: 4, data: payload(components, ephemeral) });
}

/** Edit the message the component lives on (type 7). */
export function v2Update(components: Component[]) {
  return Response.json({ type: 7, data: { flags: IS_COMPONENTS_V2, components } });
}

/** Quick single-line notice card. */
export function notice(message: string, accent: number = COLORS.neutral, ephemeral = true) {
  return v2Reply([container(accent, [text(message)])], ephemeral);
}
