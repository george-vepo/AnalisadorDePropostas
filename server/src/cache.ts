export const buildCacheKey = (codProposta: string, pipelineHash: string) => {
  return `${codProposta}:${pipelineHash}`;
};
