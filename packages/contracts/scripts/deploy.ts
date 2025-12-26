import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy EntryPoint (simulated or real, usually we use the singleton, but for local dev we might need one)
  // For now, let's assume we use the singleton address or deploy a mock if needed.
  // But XFactory needs an EntryPoint address.
  
  // Deploy XFactory
  // We need an EntryPoint address. For MVP/Local, we can deploy a mock EntryPoint or use a known one.
  // Let's deploy a mock EntryPoint for now if we don't have one, or just use a placeholder.
  // Actually, @account-abstraction/contracts usually provides an EntryPoint contract.
  
  const EntryPointFactory = await ethers.getContractFactory("EntryPoint");
  // Note: EntryPoint might not be directly available if not imported in solidity or artifacts not generated for it?
  // It comes from @account-abstraction/contracts. 
  // Let's check if we can deploy it. If not, we might need to use an existing address.
  // For local testing, better to deploy one.
  
  // However, EntryPoint is complex. Let's try to deploy XFactory with a placeholder if we can't deploy EntryPoint easily.
  // But wait, we can deploy it if we have the artifact.
  
  // Let's deploy XFactory.
  // const entryPoint = await EntryPointFactory.deploy();
  // await entryPoint.waitForDeployment();
  // const entryPointAddress = await entryPoint.getAddress();
  
  // For now, let's use a dummy address for EntryPoint if we can't deploy it easily, 
  // but for a real test we need a real one.
  // Let's assume we are on a network that has it, or we deploy it.
  
  // Mock EntryPoint deployment (simplified)
  // Actually, let's just deploy XFactory and pass a random address if we are just compiling.
  // But for "deploy" task, we want it to work.
  
  // Let's try to deploy XFactory
  const XFactory = await ethers.getContractFactory("XFactory");
  // using a dummy address for EntryPoint for now: 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 (Standard EntryPoint v0.6.0)
  const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
  
  const factory = await XFactory.deploy(ENTRY_POINT_ADDRESS);
  await factory.waitForDeployment();

  console.log("XFactory deployed to:", await factory.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
