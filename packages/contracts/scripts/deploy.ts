import { ethers } from "hardhat";

const SINGLETON_CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

async function deployDeterministic(
  deployer: any,
  initCode: string,
  salt: string,
): Promise<string> {
  const provider = deployer.provider;
  if (!provider) {
    throw new Error('Deployer signer has no provider.');
  }

  const factoryCode = await provider.getCode(SINGLETON_CREATE2_FACTORY);
  if (!factoryCode || factoryCode === '0x') {
    throw new Error('Singleton CREATE2 factory not deployed on this chain');
  }

  const initCodeHash = ethers.keccak256(initCode);
  const predicted = ethers.getCreate2Address(SINGLETON_CREATE2_FACTORY, salt, initCodeHash);
  const existingCode = await provider.getCode(predicted);
  if (existingCode && existingCode !== '0x') {
    return predicted;
  }

  const factory = new ethers.Contract(
    SINGLETON_CREATE2_FACTORY,
    ["function deploy(bytes _initCode, bytes32 _salt) public returns (address)"]
  ).connect(deployer);

  const tx = await (factory as any).deploy(initCode, salt);
  await tx.wait();
  return predicted;
}

function saltFor(label: string): string {
  const base = (process.env.UNIVERSAL_CREATE2_SALT || 'xvault-universal-v1').trim();
  return ethers.keccak256(ethers.toUtf8Bytes(`${base}:${label}`));
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      'No deployer signer available. Set DEPLOYER_PRIVATE_KEY in your environment (used by hardhat.config.ts) before running this script.'
    );
  }
  if (!deployer.provider) {
    throw new Error('Deployer signer has no provider. Check your hardhat network RPC URL configuration.');
  }

  console.log("Deploying contracts with the account:", deployer.address);

  const network = await deployer.provider.getNetwork();
  const chainId = Number(network.chainId);

  const deterministic = String(process.env.DETERMINISTIC_DEPLOY || '').trim() === '1';

  // Deploy EntryPoint (simulated or real, usually we use the singleton, but for local dev we might need one)
  // For now, let's assume we use the singleton address or deploy a mock if needed.
  // But XFactory needs an EntryPoint address.
  
  // Deploy XFactory
  // We need an EntryPoint address. For MVP/Local, we can deploy a mock EntryPoint or use a known one.
  // Let's deploy a mock EntryPoint for now if we don't have one, or just use a placeholder.
  // Actually, @account-abstraction/contracts usually provides an EntryPoint contract.
  
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
  const DEFAULT_ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

  const getEnvByChainId = (baseKey: string): string | undefined => {
    const v1 = process.env[`${baseKey}_${chainId}`];
    if (v1 && v1.length > 0) return v1.trim();
    const v0 = process.env[baseKey];
    if (v0 && v0.length > 0) return v0.trim();
    return undefined;
  };

  const normalizePrivateKey = (k: string | undefined): string | undefined => {
    if (!k) return undefined;
    const key = k.trim();
    if (key.length === 0) return undefined;
    // allow both "0x"-prefixed and raw 64-hex keys
    if (/^[0-9a-fA-F]{64}$/.test(key)) return `0x${key}`;
    return key;
  };

  const ENTRY_POINT_ADDRESS = getEnvByChainId('ENTRY_POINT_ADDRESS') || DEFAULT_ENTRY_POINT_ADDRESS;

  // Deploy P256Verifier (EIP-7212 fallback) and XAccount implementation.
  // These should be deployed deterministically across chains for universal addresses.
  const P256Verifier = await ethers.getContractFactory('P256Verifier');
  let p256VerifierAddress: string;
  if (deterministic) {
    const txReq = await P256Verifier.getDeployTransaction();
    const initCode = String(txReq.data || '');
    if (!initCode || initCode === '0x') {
      throw new Error('Failed to build P256Verifier init code');
    }
    p256VerifierAddress = await deployDeterministic(
      deployer,
      initCode,
      saltFor('P256Verifier'),
    );
  } else {
    const p256Verifier = await P256Verifier.deploy();
    await p256Verifier.waitForDeployment();
    p256VerifierAddress = await p256Verifier.getAddress();
  }
  console.log('P256Verifier deployed to:', p256VerifierAddress);

  const XAccount = await ethers.getContractFactory('XAccount');
  let accountImplAddress: string;
  if (deterministic) {
    const txReq = await XAccount.getDeployTransaction(ENTRY_POINT_ADDRESS, p256VerifierAddress);
    const initCode = String(txReq.data || '');
    if (!initCode || initCode === '0x') {
      throw new Error('Failed to build XAccount init code');
    }
    accountImplAddress = await deployDeterministic(
      deployer,
      initCode,
      saltFor('XAccountImplementation'),
    );
  } else {
    const accountImpl = await XAccount.deploy(ENTRY_POINT_ADDRESS, p256VerifierAddress);
    await accountImpl.waitForDeployment();
    accountImplAddress = await accountImpl.getAddress();
  }
  console.log('XAccount implementation deployed to:', accountImplAddress);

  const existingFactoryAddress = getEnvByChainId('FACTORY_ADDRESS');
  let factoryAddress: string;
  if (
    existingFactoryAddress &&
    ethers.isAddress(existingFactoryAddress) &&
    existingFactoryAddress !== ethers.ZeroAddress
  ) {
    factoryAddress = ethers.getAddress(existingFactoryAddress);
    console.log('Using existing XFactory:', factoryAddress);
  } else {
    if (deterministic) {
      const txReq = await XFactory.getDeployTransaction(accountImplAddress);
      const initCode = String(txReq.data || '');
      if (!initCode || initCode === '0x') {
        throw new Error('Failed to build XFactory init code');
      }
      factoryAddress = await deployDeterministic(
        deployer,
        initCode,
        saltFor('XFactory'),
      );
      console.log('XFactory deployed to:', factoryAddress);
    } else {
      const factory = await XFactory.deploy(accountImplAddress);
      await factory.waitForDeployment();
      factoryAddress = await factory.getAddress();
      console.log("XFactory deployed to:", factoryAddress);
    }
  }

  const paymasterSigningKey = normalizePrivateKey(getEnvByChainId('PAYMASTER_SIGNING_KEY'));
  const paymasterVerifyingSigner = getEnvByChainId('PAYMASTER_VERIFYING_SIGNER')
    || (paymasterSigningKey ? ethers.computeAddress(paymasterSigningKey) : undefined);

  const existingPaymasterAddress = getEnvByChainId('PAYMASTER_ADDRESS');
  let paymasterAddress: string | undefined;
  if (
    existingPaymasterAddress &&
    ethers.isAddress(existingPaymasterAddress) &&
    existingPaymasterAddress !== ethers.ZeroAddress
  ) {
    paymasterAddress = ethers.getAddress(existingPaymasterAddress);
    console.log('Using existing XPaymaster:', paymasterAddress);
  } else if (paymasterVerifyingSigner) {
    const XPaymaster = await ethers.getContractFactory('XPaymaster');
    const paymaster = await XPaymaster.deploy(ENTRY_POINT_ADDRESS, paymasterVerifyingSigner);
    await paymaster.waitForDeployment();
    paymasterAddress = await paymaster.getAddress();
    console.log('XPaymaster deployed to:', paymasterAddress);
    console.log('XPaymaster verifyingSigner:', paymasterVerifyingSigner);
  } else {
    console.log(
      'Skipping XPaymaster deploy: set PAYMASTER_SIGNING_KEY (or PAYMASTER_VERIFYING_SIGNER) in your environment.'
    );
  }

  console.log('\n--- Render env mapping ---');
  console.log(`ENTRY_POINT_ADDRESS_${chainId}=${ENTRY_POINT_ADDRESS}`);
  console.log(`FACTORY_ADDRESS_${chainId}=${factoryAddress}`);
  console.log(`P256_VERIFIER_ADDRESS_${chainId}=${p256VerifierAddress}`);
  console.log(`ACCOUNT_IMPLEMENTATION_${chainId}=${accountImplAddress}`);
  if (paymasterAddress) {
    console.log(`PAYMASTER_ADDRESS_${chainId}=${paymasterAddress}`);
    if (paymasterVerifyingSigner) {
      console.log(`PAYMASTER_VERIFYING_SIGNER_${chainId}=${paymasterVerifyingSigner}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
