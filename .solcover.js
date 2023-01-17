module.exports = {
  configureYulOptimizer: true,
  solcOptimizerDetails: {
    peephole: false,
    jumpdestRemover: false,
    orderLiterals: true,
    deduplicate: false,
    cse: false,
    constantOptimizer: false,
    yul: true,
  },
};
