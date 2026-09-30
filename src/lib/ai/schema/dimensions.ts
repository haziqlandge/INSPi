import type { Mode } from '../../types';

/** The 24 dimensions every analysis reports, whatever the mode. */
export const COMMON_DIMENSIONS = [
  'composition',
  'spatial_relationships',
  'visual_hierarchy',
  'typography',
  'color_system',
  'contrast',
  'lighting',
  'geometry',
  'shapes',
  'negative_space',
  'image_treatment',
  'texture',
  'material',
  'depth',
  'perspective',
  'alignment',
  'density',
  'borders',
  'corners',
  'shadows',
  'gradients',
  'overlays',
  'repetition',
  'rhythm',
] as const;

export const WEB_DIMENSIONS = ['interaction_cues', 'motion_cues', 'responsive_cues'] as const;
export const IMAGE_DIMENSIONS = ['medium_technique', 'camera_lens', 'subject_treatment'] as const;

const BY_MODE: Record<Mode, readonly string[]> = {
  web: [...COMMON_DIMENSIONS, ...WEB_DIMENSIONS],
  image: [...COMMON_DIMENSIONS, ...IMAGE_DIMENSIONS],
};

export function dimensionsFor(mode: Mode): readonly string[] {
  return BY_MODE[mode];
}

/** What to measure for each dimension. Sent in full only when the token budget allows. */
export const RUBRIC: Record<string, string> = {
  composition: 'overall structure: grid or freeform, symmetry, focal point, where weight sits, aspect ratio',
  spatial_relationships: 'how elements relate: overlap, nesting, proximity grouping, gaps relative to element size',
  visual_hierarchy: 'reading order, how many levels, what makes level 1 dominant (size, weight, colour, isolation)',
  typography: 'classification (serif, grotesque, mono…), weight, width, case, tracking, size ratio between levels, line height, nearest known typeface',
  color_system: 'number of hues, dominant / secondary / accent split, temperature, saturation range, how the accent is rationed',
  contrast: 'lightest vs darkest value, text-to-ground contrast, where contrast peaks, overall key (high, mid, low)',
  lighting: 'source count, direction, hardness, colour temperature, falloff, glow or bloom',
  geometry: 'underlying grid or construction lines, dominant angles, proportions and ratios',
  shapes: 'recurring primitives, organic vs geometric, edge quality, shape scale range',
  negative_space: 'share of empty area, where it pools, margin-to-content ratio',
  image_treatment: 'crop, masking, colour grade, filters, blend modes, duotone, grain applied to imagery',
  texture: 'surface noise, grain size, paper or fabric feel, pattern scale, flat vs tactile',
  material: 'what surfaces appear made of: glass, metal, paper, plastic, fabric; gloss vs matte; translucency',
  depth: 'number of planes, how they separate (blur, shadow, scale, overlap), parallax potential',
  perspective: 'viewpoint, vanishing points, isometric / orthographic / flat, tilt, lens distortion',
  alignment: 'edges things snap to, left / centre / right bias, baseline consistency, deliberate misalignment',
  density: 'elements per area, tight vs airy, information load, padding relative to content',
  borders: 'presence, thickness, colour, style, where they are used and where they are not',
  corners: 'radius relative to element height, consistency across elements, sharp vs soft',
  shadows: 'offset, blur, spread, colour, opacity, number of layers, direction consistency',
  gradients: 'type (linear, radial, mesh), angle, stops with colours, smoothness, where they are applied',
  overlays: 'scrims, tints, blur layers, translucent panels, text-over-image handling',
  repetition: 'what repeats (modules, motifs, intervals), how many times, how strictly',
  rhythm: 'repeating interval, spacing scale ratio, alternation or syncopation pattern',
  interaction_cues: 'what looks clickable or interactive and why; implied hover, focus and pressed states',
  motion_cues: 'implied movement: direction, easing feel, staggering, what would animate on load or scroll',
  responsive_cues: 'how blocks would stack or scale on a narrow screen; what must stay together',
  medium_technique: 'medium and process: photo, 3D render, vector, oil, ink, collage; brush or render signature',
  camera_lens: 'focal length feel, depth of field, angle, distance, motion blur, film or sensor character',
  subject_treatment: 'how subjects are posed, framed, stylised and simplified; never who or what they are',
};
