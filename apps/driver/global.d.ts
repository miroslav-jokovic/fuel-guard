declare module '*.css' {
  const stylesheet: string;
  export default stylesheet;
}

declare module '*.png' {
  const source: number;
  export default source;
}

// Metro resolves an image import to an opaque asset id, the same as a PNG. Declared so the hero
// texture (D-DB20) arrives typed rather than as `any` — an untyped require is the shape eslint's
// no-unsafe-assignment exists to catch, and silencing it at the call site would have hidden the
// next genuinely untyped import too.
declare module '*.webp' {
  const source: number;
  export default source;
}
