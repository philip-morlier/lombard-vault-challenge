import { ethers } from 'ethers';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const vaultAbi = JSON.parse(fs.readFileSync('./abi.json', 'utf8'));
const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const LBTC = "0x8236a87084f8b84306f72007f36f2618a5634494";
const PSEUDO = "0x79851BB0db6b03F348fA9c98ef5D23AD3B03b014";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, vaultAbi, wallet);
const lbtc = new ethers.Contract(LBTC, erc20Abi, wallet);

function fmt6(val: bigint, decimals: number): string {
  return parseFloat(ethers.formatUnits(val, decimals)).toFixed(6);
}

async function main() {

  const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
    vault.name(),
    vault.symbol(),
    vault.decimals(),
    vault.totalSupply(),
    vault.owner()
  ]);
  
  const vaultLbtcBalance = await lbtc.balanceOf(process.env.VAULT_ADDRESS!);
  
  console.log(`Vault: ${name}`);
  // APY is not available on-chain. Retrieved from Lombard dashboard
  console.log(`APY: 1.2%`);
  console.log(`TVL: ${ethers.formatUnits(vaultLbtcBalance, 8)} LBTC`);
  console.log(`Token: ${await lbtc.symbol()} (${await lbtc.decimals()} decimals)`);
  console.log();

  const pseudoAddress = ethers.getAddress(PSEUDO.toLowerCase());
  const pseudoBalance = await lbtc.balanceOf(pseudoAddress);
  
  if (pseudoBalance < ethers.parseUnits("0.01", 8)) {
    console.error("Pseudo has insufficient LBTC funds");
    process.exit(1);
  }
  
  await provider.send("anvil_impersonateAccount", [pseudoAddress]);
  const pseudoSigner = await provider.getSigner(pseudoAddress);
  const lbtcAspseudo = new ethers.Contract(LBTC, erc20Abi, pseudoSigner);
  await lbtcAspseudo.transfer(wallet.address, ethers.parseUnits("0.01", 8));
  await provider.send("anvil_stopImpersonatingAccount", [pseudoAddress]);

  const sharesBefore = await vault.balanceOf(wallet.address);
  console.log(`\nWallet: ${wallet.address}`);
  console.log(`Balance before: ${fmt6(sharesBefore, decimals)}`);
  
  console.log("Depositing...");
  const depositAmt = ethers.parseUnits("0.0000001", 8);
  
  let sharesToMint = depositAmt;
  if (totalSupply > 0) {
    const vaultAssets = await lbtc.balanceOf(process.env.VAULT_ADDRESS!);
    sharesToMint = (depositAmt * totalSupply) / vaultAssets;
  }
  
  await (await lbtc.approve(process.env.VAULT_ADDRESS!, depositAmt)).wait();
  
  await provider.send("anvil_impersonateAccount", [owner]);
  const ownerSigner = await provider.getSigner(owner);
  const vaultAsOwner = vault.connect(ownerSigner);
  
  const tx1 = await vaultAsOwner.enter(wallet.address, LBTC, depositAmt, wallet.address, sharesToMint);
  await tx1.wait();
  await provider.send("anvil_stopImpersonatingAccount", [owner]);

  const sharesAfterDeposit = await vault.balanceOf(wallet.address);
  console.log(`Balance after: ${fmt6(sharesAfterDeposit, decimals)}`);
  
  console.log("Withdrawing...");
  const sharesToBurn = sharesAfterDeposit;
  const vaultAssets = await lbtc.balanceOf(process.env.VAULT_ADDRESS!);
  const assetsToReturn = (sharesToBurn * vaultAssets) / await vault.totalSupply();
  
  await provider.send("anvil_impersonateAccount", [owner]);
  const tx2 = await vaultAsOwner.exit(wallet.address, LBTC, assetsToReturn, wallet.address, sharesToBurn);
  await tx2.wait();
  await provider.send("anvil_stopImpersonatingAccount", [owner]);
  
  const sharesFinal = await vault.balanceOf(wallet.address);
  console.log(`Balance final: ${fmt6(sharesFinal, decimals)}`);
  console.log("✅ Complete!");
  
}

main().catch(console.error);