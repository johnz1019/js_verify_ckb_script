import * as fs from 'fs';
import CKB from '@nervosnetwork/ckb-sdk-core';
import * as Config from './config/chain';
import { privateKeyToAddress, AddressPrefix, PERSONAL, hexToBytes, AddressType } from '@nervosnetwork/ckb-sdk-utils';
import blake2b from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake2b';
import { serializeInput } from '@nervosnetwork/ckb-sdk-utils/lib/serialization/transaction';
import { numberToHex, hexToNumber } from 'web3-utils';

export class Deployer {
  private ckb: CKB;
  private privKey: string;
  private pubkeHash: string;
  private address: string;
  private secp256k1Dep: DepCellInfo;

  constructor(ckb: CKB, privKey: string, pubkeyHash: string, secp256k1Dep: DepCellInfo) {
    this.ckb = ckb;
    this.privKey = privKey;
    this.pubkeHash = pubkeyHash;
    this.secp256k1Dep = secp256k1Dep;
    this.address = privateKeyToAddress(privKey, {
      prefix: AddressPrefix.Testnet,
      type: AddressType.HashIdx,
      codeHashOrCodeHashIndex: '0x00',
    });
  }

  buildDeployScriptTx(capacity: number, data: string, unspentCells: CachedCell[]): CKBComponents.RawTransactionToSign {
    console.log('unspent cell length', unspentCells.length);

    const rawTransaction = this.ckb.generateRawTransaction({
      fromAddress: this.address,
      toAddress: this.address,
      capacity: BigInt(capacity * 10 ** 8),
      fee: BigInt(100000),
      safeMode: true,
      cells: unspentCells,
      deps: this.secp256k1Dep,
    });

    rawTransaction.witnesses = rawTransaction.inputs.map(() => '0x');
    rawTransaction.witnesses[0] = { lock: '', inputType: '', outputType: '' };
    rawTransaction.outputsData[0] = data;

    // set cell to no one can unlocked
    // rawTransaction.outputs[0].lock = {
    //     hashType: 'data',
    //     codeHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    //     args: '0x',
    // }

    return rawTransaction;
  }

  async deployScript(filePath: string, capacity: number, unspentCells: CachedCell[], withType: boolean) {
    const data = fs.readFileSync(filePath);
    const s = blake2b(32, null, null, PERSONAL);
    s.update(hexToBytes('0x' + data.toString('hex')));
    const codeHash = `0x${s.digest('hex')}`;
    console.log('code_hash', codeHash);
    console.log('data', data.toString('hex').length);

    const rawTransaction = this.buildDeployScriptTx(capacity, '0x' + data.toString('hex'), unspentCells);

    if (withType) {
      const args = serializeInput(rawTransaction.inputs[0]);
      console.log('args', args);

      rawTransaction.outputs[0].type = {
        hashType: 'data',
        codeHash: Config.upgradableCell.codeHash,
        args,
      };

      rawTransaction.cellDeps.push({
        outPoint: { txHash: Config.upgradableCell.outPoint.txHash, index: '0x0' },
        depType: 'code',
      });
    }
    const signedTx = this.ckb.signTransaction(this.privKey)(rawTransaction, []);
    const realTxHash = await this.ckb.rpc.sendTransaction(signedTx);

    console.log(`The real transaction hash is: ${realTxHash}`);
  }

  async upgradeScript(unspentCells: CachedCell[], oldCell: Config.MyCellInfo, filePath: string) {
    const data = fs.readFileSync(filePath);

    const s = blake2b(32, null, null, PERSONAL);
    s.update(hexToBytes('0x' + data.toString('hex')));
    const codeHash = `0x${s.digest('hex')}`;
    console.log('updated_code_hash', codeHash);
    console.log('data', data.toString('hex').length);

    const rawTransaction = this.ckb.generateRawTransaction({
      fromAddress: this.address,
      toAddress: this.address,
      capacity: '0x0',
      fee: BigInt(100000),
      safeMode: true,
      cells: unspentCells,
      deps: this.secp256k1Dep,
      capacityThreshold: '0x0',
    });
    rawTransaction.outputs.splice(0, 1);
    rawTransaction.outputsData.splice(0, 1);

    rawTransaction.inputs.unshift({ previousOutput: oldCell.outPoint, since: '0x0' });
    rawTransaction.outputs.unshift({
      capacity: oldCell.capacity,
      lock: oldCell.lock,
      type: oldCell.type,
    });
    rawTransaction.outputsData.unshift('0x' + data.toString('hex'));

    rawTransaction.witnesses = rawTransaction.inputs.map(() => '0x');
    rawTransaction.witnesses[0] = { lock: '', inputType: '', outputType: '' };

    rawTransaction.cellDeps.push({
      outPoint: { txHash: Config.upgradableCell.outPoint.txHash, index: '0x0' },
      depType: 'code',
    });
    console.log(JSON.stringify(rawTransaction));

    const signedTx = this.ckb.signTransaction(this.privKey)(rawTransaction, []);
    console.log(JSON.stringify(signedTx, null, 2));
    const realTxHash = await this.ckb.rpc.sendTransaction(signedTx);
    console.log(`The real transaction hash is: ${realTxHash}`);
  }
}
