# Cosmograph-GraphML

`cosmograph-graphml` is a lightweight utility for visualizing GraphML files using [Cosmograph](https://cosmograph.app/), an interactive GPU-accelerated graph visualization tool.  
It provides a simple workflow to load local or generated `.graphml` or `.gpickle` networks directly into Cosmograph in the browser.


## Requirements

- Node.js ≥ 20.19 or ≥ 22.12 (Vite 7+ requires this)
- Optional: nvm for Node version management

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/<your-username>/cosmograph-graphml.git
   cd cosmograph-graphml
   ```

2. Install dependencies:
    ```bash
    # Download and install nvm
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    nvm install 22
    nvm use 22

    # Confirm download (should print v22.x.x)
    node -v

    npm install
    npm install @cosmos.gl/graph graphology graphology-graphml vite typescript
    npm install --save-dev ts-node @types/node
    ```

## Usage
1. Prepare your `.graphml` or `.gpickle` file into the `public/data/` directory.

2. Run the Python script to generate a binary edge-list
    - Note: the `--sample` and `--seed` arguments are optional.
    ```bash
    python src/convert_graph_to_binay_pairs.py \
        --input "<PATH_TO_YOUR_INPUT_FILE>" \
        --sample <NUMBER_OF_RANDOM_EDGES_TO_SAMPLE> \ 
        --seed 42
    ```

2. Start the local server
    ```bash
    npm run dev
    ```

3. Vite will start a local server, e.g.:
    ```arduino
    ➜  Local:   http://localhost:5173/
    ```

## To Build for Production
1. To create an optimized static build, run:
    ```bash
    npm run build
    ```