import { ethers } from 'ethers';
import { NETWORKS, BRIDGES } from '../config';

// Wormhole Core Bridge ABI (simplified)
const WORMHOLE_ABI = [
  "function postVAAs(bytes[] calldata _vaas) external payable returns (uint64)",
  "function redeem(uint64 _sequence, bytes calldata _vaa) external returns (uint256 amount)",
  "event TransferCompleted(uint64 indexed nonce, address indexed sender, uint16 chain, address senderAddress, uint16 toChain, address toAddress, uint256 amountToken, bytes32 tokenAddress)"
];

export class WormholeConnector {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet | null = null;
  private bridgeContract: ethers.Contract;

  constructor(network: keyof typeof NETWORKS) {
    const networkConfig = NETWORKS[network];
    this.provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    // Get bridge address for this chain from config, fallback to Ethereum
    const bridgeAddress = (BRIDGES.wormhole as any)[network] || BRIDGES.wormhole.ethereum;
    this.bridgeContract = new ethers.Contract(
      bridgeAddress,
      WORMHOLE_ABI,
      this.provider
    ) as ethers.Contract;
  }

  setSigner(signer: ethers.Wallet) {
    this.signer = signer;
    if (this.signer) {
      this.bridgeContract = this.bridgeContract.connect(this.signer) as ethers.Contract;
    }
  }

  async postVAAs(vaas: string[]): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set');
    }
    const tx = await this.bridgeContract.postVAAs(vaas, {
      // Value might be needed for fee on some chains
    });
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async redeem(sequence: number | bigint, vaa: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set');
    }
    const tx = await this.bridgeContract.redeem(sequence, vaa);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async monitorTransfers(callback: (event: any) => void): Promise<() => void> {
    const filter = this.bridgeContract.filters.TransferCompleted();
    this.bridgeContract.on(filter, callback);
    // Return a function to remove listener
    return () => {
      this.bridgeContract.off(filter, callback);
    };
  }
}