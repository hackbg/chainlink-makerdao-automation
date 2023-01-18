import { BigNumber, Contract, Event } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { abi as UniswapV3FactoryABI } from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { IUniswapV3Pool } from "../../typechain/IUniswapV3Pool";
import { FeeAmount, getMaxTick, getMinTick, TICK_SPACINGS } from "./ticks";
import { ProcessEnv } from "../../types";

const { STAGING_UNISWAP_V3_FACTORY } = process.env as ProcessEnv;

export async function findOrCreatePool(
  token0: string,
  token1: string,
  ratio: BigNumber,
  provider: SignerWithAddress
): Promise<IUniswapV3Pool> {
  const uniswapFactoryContract = new ethers.Contract(
    STAGING_UNISWAP_V3_FACTORY!,
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
    pool = await createPool(token0, token1, ratio, provider);
  }
  return pool;
}

export async function addLiquidity(
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
    token0: linkToken.address,
    token1: paymentToken.address,
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

export async function createPool(
  token0: string,
  token1: string,
  ratio: BigNumber,
  provider: SignerWithAddress
) {
  const uniswapFactoryContract = new ethers.Contract(
    STAGING_UNISWAP_V3_FACTORY!,
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
