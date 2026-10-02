import { ethers } from 'ethers';
import { NETWORKS } from '../config';

export interface DexOverrides {
  rpcUrl?: string;
  factory?: string;
  router?: string;
  quoter?: string;
  weth?: string;
}

export abstract class AbstractDEX {
  protected provider: ethers.JsonRpcProvider;
  protected signer: ethers.Wallet | undefined = undefined;
  protected wethAddress: string = '';
  protected overrides: DexOverrides;

  constructor(network: keyof typeof NETWORKS, overrides: DexOverrides = {}) {
    this.overrides = overrides;
    const networkConfig = NETWORKS[network];
    const rpc = overrides.rpcUrl || networkConfig.rpcUrl;
    this.provider = new ethers.JsonRpcProvider(rpc);
    if (overrides.weth && /^0x[0-9a-fA-F]{40}$/.test(overrides.weth)) {
      this.wethAddress = overrides.weth;
    }
  }
  abstract setSigner(signer: ethers.Wallet): void;

  abstract getReserves(tokenA: string, tokenB: string): Promise<[bigint, bigint, bigint]>;

  abstract getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint;

  abstract getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint;

  abstract getQuote(amountIn: bigint, tokenIn: string, tokenOut: string): Promise<bigint>;

  abstract buildSwapTx(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    amountOutMin: bigint,
    to: string,
    deadline: number
  ): Promise<ethers.TransactionRequest>;

  abstract getLiquidityAmount(tokenA: string, tokenB: string, amountA: bigint, amountB: bigint): Promise<bigint>;

  abstract computePairAddress(tokenA: string, tokenB: string): Promise<string>;
}