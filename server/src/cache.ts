export const buildCacheKey = (codProposta: string, pipelineHash: string, mode: string) => {
  return `${codProposta}:${pipelineHash}:${mode}`;
};
