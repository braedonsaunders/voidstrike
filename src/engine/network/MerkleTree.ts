/**
 * Merkle Tree for Efficient Desync Detection
 *
 * Provides O(log n) divergence detection instead of O(n) by building a
 * hierarchical hash tree. When desync is detected, binary search down
 * the tree identifies the exact divergent entities.
 *
 * Tree Structure:
 *                     [Root Hash]
 *                    /           \
 *           [Units Hash]      [Buildings Hash]      [Resources Hash]
 *           /         \        /            \
 *     [Player1]    [Player2]  [Player1]    [Player2]
 *        /    \
 *   [Entity1] [Entity2]...
 *
 * Same technique Git uses for detecting file changes.
 */

// =============================================================================
// Types
// =============================================================================

export interface MerkleNode {
  hash: number;
  /** Type of node: 'root', 'category', 'group', 'entity' */
  type: 'root' | 'category' | 'group' | 'entity';
  /** Label for debugging (e.g., 'units', 'player1', 'entity:42') */
  label: string;
  /** Child nodes (empty for leaf nodes) */
  children: MerkleNode[];
  /** Entity ID (only for leaf nodes) */
  entityId?: number;
  /** Entity type for leaf nodes */
  entityType?: 'unit' | 'building' | 'resource' | 'projectile';
}

export interface MerkleTreeData {
  root: MerkleNode;
  tick: number;
  timestamp: number;
  entityCount: number;
}

export interface DivergenceResult {
  /** Path from root to divergent node */
  path: string[];
  /** Divergent entity IDs (if identified) */
  entityIds: number[];
  /** Local hashes along the path */
  localHashes: number[];
  /** Remote hashes along the path */
  remoteHashes: number[];
  /** Number of comparisons made (should be O(log n)) */
  comparisons: number;
}

// =============================================================================
// Merkle Tree Builder
// =============================================================================

export class MerkleTreeBuilder {
  /**
   * Combine two hash values using boost::hash_combine algorithm
   */
  public static hashCombine(hash: number, value: number): number {
    hash ^= value + 0x9e3779b9 + (hash << 6) + (hash >> 2);
    return hash | 0;
  }

  /**
   * Hash a string deterministically
   */
  public static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = MerkleTreeBuilder.hashCombine(hash, str.charCodeAt(i));
    }
    return hash;
  }

  /**
   * Compute hash of all children
   */
  public static computeParentHash(children: MerkleNode[]): number {
    let hash = 0;
    for (const child of children) {
      hash = MerkleTreeBuilder.hashCombine(hash, child.hash);
    }
    return hash >>> 0; // Ensure unsigned
  }

  /**
   * Create a leaf node for an entity
   */
  public static createEntityNode(
    entityId: number,
    entityType: 'unit' | 'building' | 'resource' | 'projectile',
    hash: number
  ): MerkleNode {
    return {
      hash: hash >>> 0,
      type: 'entity',
      label: `${entityType}:${entityId}`,
      children: [],
      entityId,
      entityType,
    };
  }

  /**
   * Create a group node (e.g., player1's units)
   */
  public static createGroupNode(label: string, children: MerkleNode[]): MerkleNode {
    // Sort children by entity ID for deterministic ordering
    children.sort((a, b) => (a.entityId || 0) - (b.entityId || 0));

    return {
      hash: MerkleTreeBuilder.computeParentHash(children),
      type: 'group',
      label,
      children,
    };
  }

  /**
   * Create a category node (e.g., 'units')
   */
  public static createCategoryNode(label: string, children: MerkleNode[]): MerkleNode {
    // Sort children by label for deterministic ordering
    children.sort((a, b) => a.label.localeCompare(b.label));

    return {
      hash: MerkleTreeBuilder.computeParentHash(children),
      type: 'category',
      label,
      children,
    };
  }

  /**
   * Create the root node
   */
  public static createRootNode(children: MerkleNode[]): MerkleNode {
    // Sort children by label for deterministic ordering
    children.sort((a, b) => a.label.localeCompare(b.label));

    return {
      hash: MerkleTreeBuilder.computeParentHash(children),
      type: 'root',
      label: 'root',
      children,
    };
  }
}

// =============================================================================
// Merkle Tree Comparator
// =============================================================================

export class MerkleTreeComparator {
  /**
   * Find divergent entities between local and remote Merkle trees
   * Returns O(log n) instead of requiring O(n) full comparison
   */
  public static findDivergence(
    local: MerkleNode,
    remote: MerkleNode
  ): DivergenceResult {
    const result: DivergenceResult = {
      path: [],
      entityIds: [],
      localHashes: [],
      remoteHashes: [],
      comparisons: 0,
    };

    // If roots match, no divergence
    result.comparisons++;
    if (local.hash === remote.hash) {
      return result;
    }

    // Binary search down the tree
    this.findDivergenceRecursive(local, remote, result);

    return result;
  }

  private static findDivergenceRecursive(
    local: MerkleNode,
    remote: MerkleNode,
    result: DivergenceResult
  ): void {
    result.path.push(local.label);
    result.localHashes.push(local.hash);
    result.remoteHashes.push(remote.hash);

    // If this is a leaf node, we found a divergent entity
    if (local.type === 'entity') {
      if (local.entityId !== undefined) {
        result.entityIds.push(local.entityId);
      }
      return;
    }

    // Build maps of children by label
    const localChildren = new Map<string, MerkleNode>();
    for (const child of local.children) {
      localChildren.set(child.label, child);
    }

    const remoteChildren = new Map<string, MerkleNode>();
    for (const child of remote.children) {
      remoteChildren.set(child.label, child);
    }

    // Find missing children (entities that exist in one but not the other)
    for (const [label, localChild] of localChildren) {
      if (!remoteChildren.has(label)) {
        // Entity exists locally but not remotely
        result.comparisons++;
        result.path.push(`${label} (missing remotely)`);
        if (localChild.entityId !== undefined) {
          result.entityIds.push(localChild.entityId);
        }
        this.collectAllEntityIds(localChild, result.entityIds);
      }
    }

    for (const [label, remoteChild] of remoteChildren) {
      if (!localChildren.has(label)) {
        // Entity exists remotely but not locally
        result.comparisons++;
        result.path.push(`${label} (missing locally)`);
        if (remoteChild.entityId !== undefined) {
          result.entityIds.push(remoteChild.entityId);
        }
      }
    }

    // Compare matching children
    for (const [label, localChild] of localChildren) {
      const remoteChild = remoteChildren.get(label);
      if (!remoteChild) continue;

      result.comparisons++;
      if (localChild.hash !== remoteChild.hash) {
        // Found divergence - recurse down
        this.findDivergenceRecursive(localChild, remoteChild, result);
      }
    }
  }

  /**
   * Collect all entity IDs from a subtree
   */
  private static collectAllEntityIds(node: MerkleNode, entityIds: number[]): void {
    if (node.entityId !== undefined) {
      entityIds.push(node.entityId);
    }
    for (const child of node.children) {
      this.collectAllEntityIds(child, entityIds);
    }
  }

  /**
   * Serialize a Merkle tree to a compact format for network transmission
   * Only includes hashes at each level, not the full tree structure
   */
  public static serializeForNetwork(tree: MerkleTreeData): NetworkMerkleTree {
    const categoryHashes: Record<string, number> = {};
    const groupHashes: Record<string, Record<string, number>> = {};

    for (const category of tree.root.children) {
      categoryHashes[category.label] = category.hash;
      groupHashes[category.label] = {};

      for (const group of category.children) {
        groupHashes[category.label][group.label] = group.hash;
      }
    }

    return {
      rootHash: tree.root.hash,
      categoryHashes,
      groupHashes,
      tick: tree.tick,
      entityCount: tree.entityCount,
    };
  }

  /**
   * Quick check if trees are identical (just compare root hash)
   */
  public static isIdentical(local: MerkleTreeData, remote: NetworkMerkleTree): boolean {
    return local.root.hash === remote.rootHash;
  }

  /**
   * Find divergent categories without full tree comparison
   */
  public static findDivergentCategories(
    local: MerkleTreeData,
    remote: NetworkMerkleTree
  ): string[] {
    const divergent: string[] = [];

    for (const category of local.root.children) {
      const remoteHash = remote.categoryHashes[category.label];
      if (remoteHash === undefined || category.hash !== remoteHash) {
        divergent.push(category.label);
      }
    }

    // Check for categories in remote that don't exist locally
    for (const label of Object.keys(remote.categoryHashes)) {
      if (!local.root.children.some((c) => c.label === label)) {
        divergent.push(label);
      }
    }

    return divergent;
  }

  /**
   * Find divergent groups within a category
   */
  public static findDivergentGroups(
    local: MerkleTreeData,
    remote: NetworkMerkleTree,
    categoryLabel: string
  ): string[] {
    const divergent: string[] = [];

    const localCategory = local.root.children.find((c) => c.label === categoryLabel);
    if (!localCategory) return divergent;

    const remoteGroups = remote.groupHashes[categoryLabel] || {};

    for (const group of localCategory.children) {
      const remoteHash = remoteGroups[group.label];
      if (remoteHash === undefined || group.hash !== remoteHash) {
        divergent.push(group.label);
      }
    }

    // Check for groups in remote that don't exist locally
    for (const label of Object.keys(remoteGroups)) {
      if (!localCategory.children.some((g) => g.label === label)) {
        divergent.push(label);
      }
    }

    return divergent;
  }
}

// =============================================================================
// Network Types
// =============================================================================

/**
 * Compact representation for network transmission
 * Only includes hashes, not full tree structure
 */
export interface NetworkMerkleTree {
  rootHash: number;
  categoryHashes: Record<string, number>;
  groupHashes: Record<string, Record<string, number>>;
  tick: number;
  entityCount: number;
}

/**
 * Request for detailed comparison when divergence detected
 */
export interface MerkleCompareRequest {
  tick: number;
  /** Category to compare (e.g., 'units') */
  category?: string;
  /** Group to compare (e.g., 'player1') */
  group?: string;
  /** Request entity-level hashes for fine-grained comparison */
  requestEntityHashes?: boolean;
}

/**
 * Response with entity-level hashes for a specific group
 */
export interface MerkleCompareResponse {
  tick: number;
  category: string;
  group: string;
  /** Map of entityId -> hash */
  entityHashes: Record<number, number>;
}
