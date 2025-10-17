#!/usr/bin/env python3
"""
convert_gpickle_to_bin.py
Convert a NetworkX .gpickle graph to binary arrays for Cosmograph.

Outputs:
  - edges.bin: Float32Array of [src, dst, src, dst, ...]
  - positions.bin: Float32Array of [x, y, x, y, ...]
  - metadata.json: node_count, edge_count, paths to binaries

Usage:
  python src/convert_gpickle_to_bin.py \
      --input /path/to/string_mouse_full.gpickle \
      --outdir public/data \
      --sample 100000
"""

import argparse
import json
import networkx as nx
import numpy as np
import os
import pickle
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Convert NetworkX gpickle to Cosmograph binaries.")
    parser.add_argument("--input", required=True, help="Input .gpickle file")
    parser.add_argument("--sample", type=int, default=None,
                        help="Optional random sample of edges for visualization")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    args = parser.parse_args()

    np.random.seed(args.seed)
    
    outdir = Path(__file__).parent.parent.resolve() / "public" / "data" / "mm10_merged"
    
    # --- Load graph ---
    if str(args.input).endswith(".gpickle"):
        print(f"Loading graph from {args.input} ...")
        with open(args.input, 'rb') as f:
            G = pickle.load(f)
            
    elif str(args.input).endswith(".graphml"):
        print(f"Loading graph from {args.input} ...")
        G = nx.read_graphml(args.input)
        
    else:
        raise ValueError(f"ERROR: File must end with '.gpickle' or '.graphml', got {args.input} instead")
            
    num_nodes = G.number_of_nodes()
    num_edges = G.number_of_edges()
    print(f"Loaded graph with {num_nodes:,} nodes and {num_edges:,} edges")

    # --- Sample edges if requested ---
    edges = np.array(list(G.edges()), dtype=object)
    if args.sample and args.sample < len(edges):
        print(f"Sampling {args.sample:,} edges for visualization...")
        idx = np.random.choice(len(edges), args.sample, replace=False)
        edges = edges[idx]

    # --- Map node names to numeric indices ---
    nodes = list(G.nodes())
    node_to_idx = {n: i for i, n in enumerate(nodes)}
    edges_idx = np.empty(len(edges) * 2, dtype=np.float32)

    for i, (u, v) in enumerate(edges):
        edges_idx[i * 2] = node_to_idx[u]
        edges_idx[i * 2 + 1] = node_to_idx[v]

    # --- Generate node positions (random or layout) ---
    print("Generating random node positions...")
    point_positions = np.random.uniform(-1.0, 1.0, size=(num_nodes * 2)).astype(np.float32)

    # --- Prepare output paths ---
    os.makedirs(outdir, exist_ok=True)
    base = os.path.splitext(os.path.basename(args.input))[0]
    edges_path = os.path.join(outdir, f"{base}_edges.bin")
    pos_path = os.path.join(outdir, f"{base}_positions.bin")
    meta_path = os.path.join(outdir, f"{base}_metadata.json")

    # --- Write binaries ---
    print(f"Writing edges → {edges_path}")
    edges_idx.tofile(edges_path)

    print(f"Writing positions → {pos_path}")
    point_positions.tofile(pos_path)
    
    print("Collecting node names...")
    node_names = [str(n) for n in nodes]

    # --- Metadata for Cosmograph ---
    metadata = {
        "num_nodes": int(num_nodes),
        "num_edges": int(len(edges)),
        "edges_file": os.path.basename(edges_path),
        "positions_file": os.path.basename(pos_path),
        "names": node_names,
    }
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Metadata saved → {meta_path}")
    print("Conversion complete!")

if __name__ == "__main__":
    main()
