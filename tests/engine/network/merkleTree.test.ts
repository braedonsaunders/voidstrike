import {
  MerkleTreeBuilder,
  MerkleTreeComparator,
  type MerkleTreeData,
} from '@/engine/network/MerkleTree';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const buildTree = (hashOverrides?: { unit2?: number }): MerkleTreeData => {
  const unit1 = MerkleTreeBuilder.createEntityNode(1, 'unit', 111);
  const unit2 = MerkleTreeBuilder.createEntityNode(2, 'unit', hashOverrides?.unit2 ?? 222);

  const playerGroup = MerkleTreeBuilder.createGroupNode('player1', [unit2, unit1]);
  const unitsCategory = MerkleTreeBuilder.createCategoryNode('units', [playerGroup]);
  const root = MerkleTreeBuilder.createRootNode([unitsCategory]);

  return {
    root,
    tick: 10,
    timestamp: 1234,
    entityCount: 2,
  };
};

describe('MerkleTree utilities', () => {
  it('builds deterministic hashes regardless of child ordering', () => {
    const treeA = buildTree();

    const unit1 = MerkleTreeBuilder.createEntityNode(1, 'unit', 111);
    const unit2 = MerkleTreeBuilder.createEntityNode(2, 'unit', 222);
    const playerGroup = MerkleTreeBuilder.createGroupNode('player1', [unit1, unit2]);
    const unitsCategory = MerkleTreeBuilder.createCategoryNode('units', [playerGroup]);
    const root = MerkleTreeBuilder.createRootNode([unitsCategory]);

    const treeB: MerkleTreeData = {
      root,
      tick: 10,
      timestamp: 1234,
      entityCount: 2,
    };

    assert.strictEqual(treeA.root.hash, treeB.root.hash);
  });

  it('identifies divergent entities', () => {
    const local = buildTree();
    const remote = buildTree({ unit2: 999 });

    const result = MerkleTreeComparator.findDivergence(local.root, remote.root);

    assert.ok(result.entityIds.includes(2));
    assert.strictEqual(result.path[0], 'root');
    assert.ok(result.comparisons > 0);
  });

  it('finds divergent categories and groups from network summaries', () => {
    const tree = buildTree();
    const serialized = MerkleTreeComparator.serializeForNetwork(tree);

    assert.strictEqual(MerkleTreeComparator.isIdentical(tree, serialized), true);

    const tampered = {
      ...serialized,
      categoryHashes: {
        ...serialized.categoryHashes,
        units: serialized.categoryHashes.units + 1,
      },
    };

    assert.deepStrictEqual(MerkleTreeComparator.findDivergentCategories(tree, tampered), ['units']);

    const tamperedGroups = {
      ...serialized,
      groupHashes: {
        ...serialized.groupHashes,
        units: {
          ...serialized.groupHashes.units,
          player1: serialized.groupHashes.units.player1 + 1,
        },
      },
    };

    assert.deepStrictEqual(
      MerkleTreeComparator.findDivergentGroups(tree, tamperedGroups, 'units'),
      ['player1']
    );
  });
});
