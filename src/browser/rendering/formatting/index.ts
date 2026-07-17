export {
  classifyDisplay,
  isBlockLevel,
  type FormattingContextType,
  type InlineLevelBox,
  type LineBox,
  type ResolvedBox,
  type ClassifiedChild,
  type FloatExclusionZone,
} from './types';

export {
  classifyChildren,
  collapseMargins,
  isMarginCollapseBlocked,
  resolveBoxModel,
  type BlockLevelBox,
} from './block-context';

export {
  InlineFormattingContext,
  resolveVerticalAlign,
} from './inline-context';

export {
  findBreakOpportunities,
  segmentText,
  type BreakOpportunity,
  type TextSegment,
} from './line-break';

export {
  getTextMeasurer,
  setTextMeasurer,
  HeuristicTextMeasurer,
  type TextMeasurer,
  type TextMetrics,
} from './text-measure';

export {
  FlexFormattingContext,
  isRowDirection,
  computeJustifyOffset,
  computeJustifyGap,
  type FlexDirection,
  type FlexWrap,
  type JustifyContent,
  type AlignItems,
  type AlignContent,
  type AlignSelf,
  type FlexItem,
  type FlexLine,
} from './flex-context';

export {
  FloatContext,
  type PlacedFloat,
} from './float-context';

export {
  GridFormattingContext,
  parseTrackList,
  resolveTrackBase,
  parseGridPlacement,
  parseGridTemplateAreas,
  findAreaPlacement,
  type GridAutoFlow,
  type GridAxisAlign,
  type GridSelfAlign,
  type GridTrack,
  type GridPlacement,
  type GridItem,
  type GridFormattingContextOptions,
} from './grid-context';
