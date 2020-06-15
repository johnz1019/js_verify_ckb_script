import * as chain from './config/chain';

import CKB from '@nervosnetwork/ckb-sdk-core';
import { Deployer } from './deployer';
import { privateKeyToPublicKey, scriptToHash } from '@nervosnetwork/ckb-sdk-utils';
import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';

const ckb = new CKB(process.env.NODE_URL);
const pubKeyHash = `0x${blake160(privateKeyToPublicKey(chain.privateKey1), 'hex')}`;
let deployer: Deployer;

console.log('pubKeyHash is', pubKeyHash);

async function getUnspentCell(): Promise<CachedCell[]> {
  const lockHash = scriptToHash({
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: pubKeyHash,
  });
  const unspentCells = await ckb.loadCells({
    // start: '0x493e0',
    // end: endBlock,
    lockHash,
  });

  return unspentCells;
}

async function DeployUpgradableCell() {
  const unspentCells = await getUnspentCell();
  const scriptBinPath = '/Users/zhang/work/DigiCash/CKB/grands/pw-lock-script/specs/cells/ckb_cell_upgrade';
  deployer.deployScript(scriptBinPath, 50000, unspentCells, false);
}

async function DeploySecp256KeccakCell() {
  const unspentCells = await getUnspentCell();
  const scriptBinPath =
    '/Users/zhang/work/DigiCash/CKB/grands/pw-lock-script/specs/cells/secp256k1_keccak256_sighash_all';
  deployer.deployScript(scriptBinPath, 150000, unspentCells, true);
}

async function updgradeSecp256KeccakCell() {
  const unspentCells = await getUnspentCell();

  const scriptBinPath =
    '/Users/zhang/work/DigiCash/CKB/grands/pw-lock-script/specs/cells/secp256k1_keccak256_sighash_all';

  await deployer.upgradeScript(unspentCells, chain.keccak256LockCell, scriptBinPath);
}

async function DeployKeyBoundOwnershipCell() {
  const unspentCells = await getUnspentCell();
  const scriptBinPath = '/Users/zhang/work/DigiCash/CKB/grands/pw-lock-script/specs/cells/key_bound_ownership_lock';
  deployer.deployScript(scriptBinPath, 30000, unspentCells, true);
}

async function DeploySimpleOtxCell() {
  const unspentCells = await getUnspentCell();
  const scriptBinPath = '/Users/zhang/work/DigiCash/CKB/grands/pw-lock-scripts/specs/cells/simple_otx';
  deployer.deployScript(scriptBinPath, 150000, unspentCells, true);
}

async function DeployR1Cell() {
  const unspentCells = await getUnspentCell();
  const scriptBinPath =
    '/Users/zhang/work/DigiCash/CKB/webauthn/ckb-anyone-can-pay/specs/cells/secp256r1_sha256_sighash';
  deployer.deployScript(scriptBinPath, 150000, unspentCells, true);
}

async function test() {
  // console.log('process.env', process.env);
  // console.log('NODE_ENV', process.env.NODE_ENV);
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  deployer = new Deployer(ckb, chain.privateKey1, pubKeyHash, secp256k1Dep);
  // await DeployUpgradableCell();
  // await DeploySecp256KeccakCell();
  // await DeployKeyBoundOwnershipCell();
  // await DeploySimpleOtxCell();

  // await updgradeSecp256KeccakCell();

  await DeployR1Cell();
}

test();
