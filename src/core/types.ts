export type Point = [number, number];
/** 2D affine transform [a b c d e f], same as SVG matrix(). */
export type Matrix = [number, number, number, number, number, number];

export interface Subpath {
  points: Point[];
  closed: boolean;
}

export type FillRule = 'NonZero' | 'EvenOdd';
export type LineJoin = 'miter' | 'round' | 'bevel';
export type LineCap = 'butt' | 'round' | 'square';

export interface FillShape {
  kind: 'fill';
  contours: Point[][];
  fillRule: FillRule;
}

export interface StrokeShape {
  kind: 'stroke';
  paths: Subpath[];
  width: number;
  join: LineJoin;
  cap: LineCap;
  miterLimit: number;
}

/**
 * One painted shape of the drawing, in millimetres (y down, like SVG), in document order.
 * `clips` are clip regions (each a list of shapes, unioned) that the shape is intersected with.
 */
export type Shape = (FillShape | StrokeShape) & {
  /** Normalised paint colour, "#rrggbb". */
  color: string;
  /** The element that painted it, for selector matching. */
  element: Element;
  /** Grow the outline by this many mm on each side (data-grow). */
  grow: number;
  clips: Shape[][];
  /** <use> elements the shape was instanced through. */
  refs?: Element[];
};

export interface Warning {
  code: string;
  message: string;
}
