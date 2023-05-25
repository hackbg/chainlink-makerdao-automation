/* eslint-disable new-cap */
// uses both bn and BigNumber because BigNumber doesnt have sqrt function
import bn from "bignumber.js";
import { BigNumber, Contract, Event } from "ethers";
import { ethers } from "hardhat";
import { abi as UniswapV3FactoryABI } from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { abi as NonfungiblePositionManagerABI } from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { IUniswapV3Pool } from "../../typechain/IUniswapV3Pool";

export const MaxUint128 = BigNumber.from(2).pow(128).sub(1);

export enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

export const TICK_SPACINGS = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
};

export const getMinTick = (tickSpacing: number) =>
  Math.ceil(-887272 / tickSpacing) * tickSpacing;
export const getMaxTick = (tickSpacing: number) =>
  Math.floor(887272 / tickSpacing) * tickSpacing;
export const getMaxLiquidityPerTick = (tickSpacing: number) =>
  BigNumber.from(2)
    .pow(128)
    .sub(1)
    .div((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1);

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

function encodePriceSqrt(reserve1: BigNumber, reserve0: BigNumber): BigNumber {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  );
}

export async function setupPool(
  token0: Contract,
  token1: Contract,
  owner: SignerWithAddress,
  token0Liquidity: BigNumber,
  token1Liquidity: BigNumber,
  uniswapV3FactoryAddress: string,
  positionManagerAddress: string
) {
  const oneToOneRatio = encodePriceSqrt(BigNumber.from(1), BigNumber.from(1));

  const pool = await findOrCreatePool(
    token0.address,
    token1.address,
    oneToOneRatio,
    owner,
    uniswapV3FactoryAddress
  );

  const nonfungiblePositionManager = new ethers.Contract(
    positionManagerAddress,
    NonfungiblePositionManagerABI,
    owner
  );

  const minAmountToken0 = token0Liquidity.div(2);
  const minAmountToken1 = token1Liquidity.div(2);

  await addLiquidity(
    token0,
    token1,
    nonfungiblePositionManager,
    owner,
    token0Liquidity,
    token1Liquidity,
    minAmountToken0,
    minAmountToken1
  );
  return pool;
}

export async function findOrCreatePool(
  token0: string,
  token1: string,
  ratio: BigNumber,
  provider: SignerWithAddress,
  uniswapFactory: string
): Promise<IUniswapV3Pool> {
  const uniswapFactoryContract = new ethers.Contract(
    uniswapFactory,
    UniswapV3FactoryABI,
    provider
  );
  let pool: IUniswapV3Pool;
  const poolAddress = await uniswapFactoryContract.getPool(
    token0,
    token1,
    FeeAmount.MEDIUM
  );

  const doesPoolExist = poolAddress !== ethers.constants.AddressZero;
  if (doesPoolExist) {
    pool = new ethers.Contract(
      poolAddress,
      IUniswapV3PoolABI,
      provider
    ) as IUniswapV3Pool;
  } else {
    pool = await createPool(token0, token1, ratio, provider, uniswapFactory);
  }
  return pool;
}

async function addLiquidity(
  linkToken: Contract,
  paymentToken: Contract,
  nonFungiblePositionManager: Contract,
  owner: SignerWithAddress,
  amount0Desired: BigNumber,
  amount1Desired: BigNumber,
  amount0Min: BigNumber,
  amount1Min: BigNumber
) {
  await linkToken.approve(nonFungiblePositionManager.address, amount0Desired);
  await paymentToken.approve(
    nonFungiblePositionManager.address,
    amount1Desired
  );

  // getting timestamp
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  const timestampBefore = blockBefore.timestamp;

  await nonFungiblePositionManager.mint({
    token0: paymentToken.address,
    token1: linkToken.address,
    fee: FeeAmount.MEDIUM,
    tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient: owner.address,
    deadline: BigNumber.from(timestampBefore).add(60 * 10),
  });
}

async function createPool(
  token0: string,
  token1: string,
  ratio: BigNumber,
  provider: SignerWithAddress,
  uniswapV3FactoryAddress: string
) {
  const uniswapFactoryContract = new ethers.Contract(
    uniswapV3FactoryAddress,
    UniswapV3FactoryABI,
    provider
  );

  const createUniswapFactoryTx = await uniswapFactoryContract.createPool(
    token0,
    token1,
    FeeAmount.MEDIUM
  );
  const createUniswapFactoryRc = await createUniswapFactoryTx.wait();
  const createUniswapFactoryEvent = createUniswapFactoryRc.events?.find(
    (e: Event) => e.event === "PoolCreated"
  );

  const { pool: poolAddress } = createUniswapFactoryEvent?.args || [];
  const pool = new ethers.Contract(
    poolAddress,
    IUniswapV3PoolABI,
    provider
  ) as unknown as IUniswapV3Pool;

  await pool.initialize(ratio);
  return pool;
}
