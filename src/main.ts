import { Graph } from '@cosmos.gl/graph'
import './style.css'

/**
 * Loads Cosmograph binary data and returns Float32Arrays.
 */
async function loadCosmographData(
  dir: string,
  baseName: string
): Promise<{ links: Float32Array; pointPositions: Float32Array; meta: any }> {
  const jsonPath = `${dir}${baseName}_metadata.json`
  const meta = await fetch(jsonPath).then(r => r.json())

  const edgesPath = `${dir}${baseName}_edges.bin`
  const posPath = `${dir}${baseName}_positions.bin`

  const [edgesBuf, posBuf] = await Promise.all([
    fetch(edgesPath).then(r => r.arrayBuffer()),
    fetch(posPath).then(r => r.arrayBuffer()),
  ])

  const links = new Float32Array(edgesBuf)
  const pointPositions = new Float32Array(posBuf)

  console.log(
    `Loaded ${meta.num_nodes ?? pointPositions.length / 2} nodes and ${
      meta.num_edges ?? links.length / 2
    } edges`
  )

  return { links, pointPositions, meta }
}

/**
 * Main viewer with UI controls
 */
export async function graphmlViewer(): Promise<{ graph: Graph; div: HTMLDivElement }> {
  // --- UI Layout ---
  const div = document.createElement('div')
  div.className = 'app'

  const graphDiv = document.createElement('div')
  graphDiv.className = 'graph'
  div.appendChild(graphDiv)

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  div.appendChild(actionsDiv)

  const actionsHeader = document.createElement('div')
  actionsHeader.className = 'actions-header'
  actionsHeader.textContent = 'Actions'
  actionsDiv.appendChild(actionsHeader)

  // --- Point size control ---
  const sizeControl = document.createElement('div')
  sizeControl.className = 'action'
  const sizeLabel = document.createElement('label')
  sizeLabel.textContent = 'Point size'
  sizeLabel.style.marginRight = '8px'
  const sizeInput = document.createElement('input')
  sizeInput.type = 'range'
  sizeInput.min = '1'
  sizeInput.max = '40'
  sizeInput.value = '14'
  sizeInput.style.verticalAlign = 'middle'
  const sizeValue = document.createElement('span')
  sizeValue.textContent = '14'
  sizeValue.style.marginLeft = '8px'
  sizeInput.addEventListener('input', () => {
    const v = Number(sizeInput.value)
    sizeValue.textContent = String(v)
    graph.setConfig({ pointSize: v })
    graph.render()
  })
  sizeControl.appendChild(sizeLabel)
  sizeControl.appendChild(sizeInput)
  sizeControl.appendChild(sizeValue)
  actionsDiv.appendChild(sizeControl)

  // State for theme and coloring
  let isDark = true
  let colorByPT = true
  let ptColors: Float32Array | null = null
  let uniformColors: Float32Array | null = null
  let originalLinks: Float32Array | null = null
  let minAttractorSize = 0

  function rgba(hex: string): [number, number, number, number] {
    // '#RRGGBBAA' or '#RRGGBB'
    const h = hex.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255
    return [r, g, b, a]
  }

  function makeUniformColors(n: number, color: [number, number, number, number]): Float32Array {
    const arr = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      const o = i * 4
      arr[o] = color[0] / 255
      arr[o + 1] = color[1] / 255
      arr[o + 2] = color[2] / 255
      arr[o + 3] = color[3] / 255
    }
    return arr
  }

  function applyTheme(): void {
    if (isDark) {
      graph.setConfig({
        backgroundColor: '#0D1117ff',
        linkColor: '#6b728033',
        hoveredPointRingColor: '#4B5BBF',
      })
    } else {
      graph.setConfig({
        backgroundColor: '#ffffffff',
        linkColor: '#43434334',
        hoveredPointRingColor: '#3b82f6',
      })
    }
    // Re-apply colors to respect theme if using uniform colors
    applyColoring()
    graph.render()
  }

  function applyColoring(): void {
    const N = Math.floor(pointPositions.length / 2)
    const darkBase = rgba('#00ff00ff') // vivid green on dark
    const lightBase = rgba('#000000ff') // black on light
    
    if (colorByPT && ptColors) {
      // @ts-ignore
      if (typeof (graph as any).setPointColors === 'function') {
        // @ts-ignore
        ;(graph as any).setPointColors(ptColors)
      }
    } else {
      const base = isDark ? darkBase : lightBase
      uniformColors = makeUniformColors(N, base)
      // @ts-ignore
      if (typeof (graph as any).setPointColors === 'function') {
        // @ts-ignore
        ;(graph as any).setPointColors(uniformColors)
      }
    }
  }

  // --- Color by pseudotime toggle ---
  const colorCtl = document.createElement('div')
  colorCtl.className = 'action'
  const colorChk = document.createElement('input')
  colorChk.type = 'checkbox'
  colorChk.checked = true
  colorChk.id = 'color-by-pt'
  const colorLbl = document.createElement('label')
  colorLbl.htmlFor = 'color-by-pt'
  colorLbl.textContent = 'Color by pseudotime'
  colorLbl.style.marginLeft = '8px'
  colorChk.addEventListener('change', () => {
    colorByPT = colorChk.checked
    applyColoring()
    graph.render()
  })
  colorCtl.appendChild(colorChk)
  colorCtl.appendChild(colorLbl)
  actionsDiv.appendChild(colorCtl)

  // --- Theme toggle ---
  const themeCtl = document.createElement('div')
  themeCtl.className = 'action'
  const themeChk = document.createElement('input')
  themeChk.type = 'checkbox'
  themeChk.checked = true
  themeChk.id = 'theme-dark'
  const themeLbl = document.createElement('label')
  themeLbl.htmlFor = 'theme-dark'
  themeLbl.textContent = 'Dark theme'
  themeLbl.style.marginLeft = '8px'
  themeChk.addEventListener('change', () => {
    isDark = themeChk.checked
    applyTheme()
  })
  themeCtl.appendChild(themeChk)
  themeCtl.appendChild(themeLbl)
  actionsDiv.appendChild(themeCtl)

  // --- Filter by attractor size ---
  const filterCtl = document.createElement('div')
  filterCtl.className = 'action'
  const filterLabel = document.createElement('label')
  filterLabel.textContent = 'Min component size'
  filterLabel.style.marginRight = '8px'
  const filterInput = document.createElement('input')
  filterInput.type = 'range'
  filterInput.min = '1'
  filterInput.max = '500'
  filterInput.value = '1'
  filterInput.step = '1'
  filterInput.style.verticalAlign = 'middle'
  const filterValue = document.createElement('span')
  filterValue.textContent = '1'
  filterValue.style.marginLeft = '8px'
  filterInput.addEventListener('input', () => {
    const v = Number(filterInput.value)
    filterValue.textContent = String(v)
    minAttractorSize = v
    applyFiltering()
  })
  filterCtl.appendChild(filterLabel)
  filterCtl.appendChild(filterInput)
  filterCtl.appendChild(filterValue)
  actionsDiv.appendChild(filterCtl)

  function findConnectedComponents(numNodes: number, edgeList: Float32Array): Map<number, number> {
    // Build adjacency list (undirected for component analysis)
    const adj = new Map<number, Set<number>>()
    for (let i = 0; i < edgeList.length; i += 2) {
      const src = Math.floor(edgeList[i])
      const dst = Math.floor(edgeList[i + 1])
      if (!adj.has(src)) adj.set(src, new Set())
      if (!adj.has(dst)) adj.set(dst, new Set())
      adj.get(src)!.add(dst)
      adj.get(dst)!.add(src)
    }
    
    // BFS to find components
    const visited = new Set<number>()
    const nodeToComponent = new Map<number, number>()
    const componentSizes = new Map<number, number>()
    let componentId = 0
    
    for (let node = 0; node < numNodes; node++) {
      if (visited.has(node)) continue
      
      // BFS from this node
      const queue = [node]
      const componentNodes: number[] = []
      visited.add(node)
      
      while (queue.length > 0) {
        const current = queue.shift()!
        componentNodes.push(current)
        
        const neighbors = adj.get(current)
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor)
              queue.push(neighbor)
            }
          }
        }
      }
      
      // Assign component ID and size
      const size = componentNodes.length
      for (const n of componentNodes) {
        nodeToComponent.set(n, componentId)
      }
      componentSizes.set(componentId, size)
      componentId++
    }
    
    // Return map of node -> component size
    const result = new Map<number, number>()
    for (let node = 0; node < numNodes; node++) {
      const compId = nodeToComponent.get(node)
      const size = compId !== undefined ? componentSizes.get(compId) || 0 : 0
      result.set(node, size)
    }
    return result
  }

  function applyFiltering(): void {
    if (!originalLinks) {
      applyColoring()
      graph.render()
      return
    }
    
    const numNodes = Math.floor(pointPositions.length / 2)
    
    // Find connected components in the original graph
    const nodeToComponentSize = findConnectedComponents(numNodes, originalLinks)
    
    // Filter edges: keep only edges where both nodes are in large enough components
    const filteredEdges: number[] = []
    for (let i = 0; i < originalLinks.length; i += 2) {
      const src = Math.floor(originalLinks[i])
      const dst = Math.floor(originalLinks[i + 1])
      const srcSize = nodeToComponentSize.get(src) || 0
      const dstSize = nodeToComponentSize.get(dst) || 0
      
      if (srcSize >= minAttractorSize && dstSize >= minAttractorSize) {
        filteredEdges.push(originalLinks[i], originalLinks[i + 1])
      }
    }
    
    const newLinks = new Float32Array(filteredEdges)
    graph.setLinks(newLinks)
    
    // Update colors to hide filtered nodes
    applyColoringWithFilter(nodeToComponentSize)
    graph.render()
  }

  function applyColoringWithFilter(nodeToComponentSize: Map<number, number>): void {
    const N = Math.floor(pointPositions.length / 2)
    const darkBase = rgba('#00ff00ff')
    const lightBase = rgba('#000000ff')
    
    if (colorByPT && ptColors) {
      const filtered = new Float32Array(ptColors)
      for (let i = 0; i < N; i++) {
        const size = nodeToComponentSize.get(i) || 0
        if (size < minAttractorSize) {
          filtered[i * 4 + 3] = 0
        }
      }
      // @ts-ignore
      if (typeof (graph as any).setPointColors === 'function') {
        // @ts-ignore
        ;(graph as any).setPointColors(filtered)
      }
    } else {
      const base = isDark ? darkBase : lightBase
      uniformColors = makeUniformColors(N, base)
      for (let i = 0; i < N; i++) {
        const size = nodeToComponentSize.get(i) || 0
        if (size < minAttractorSize) {
          uniformColors[i * 4 + 3] = 0
        }
      }
      // @ts-ignore
      if (typeof (graph as any).setPointColors === 'function') {
        // @ts-ignore
        ;(graph as any).setPointColors(uniformColors)
      }
    }
  }

  // --- Overlay panel for node names ---
  const namesPanel = document.createElement('div')
  namesPanel.className = 'names-panel'
  namesPanel.textContent = 'No selection'
  div.appendChild(namesPanel)

  // --- Create Graph ---
  const graph = new Graph(graphDiv, {
    spaceSize: 8192,
    backgroundColor: '#0D1117ff',
    pointSize: 14,
    pointColor: '#00ff00ff',
    linkWidth: 0.4,
    linkColor: '#6b728033',
    linkArrows: true,
    scalePointsOnZoom: true,
    linkGreyoutOpacity: 0,
    curvedLinks: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#4B5BBF',
    enableDrag: true,
    enableRightClickRepulsion: true,
    simulationRepulsionFromMouse: 5,
    simulationLinkDistance: 2,
    simulationLinkSpring: 2,
    simulationRepulsion: 10,
    simulationCenter: 0.5,
    simulationGravity: 0.2,
    simulationFriction: 0.1,
    simulationCluster: 1,
    simulationDecay: 100000,
    onPointClick: (index: number): void => {
      graph.selectPointByIndex(index)
      graph.zoomToPointByIndex(index)
      updateSelectedNames([index])
      console.log('Clicked point index:', index)
    },
    onBackgroundClick: (): void => {
      graph.unselectPoints()
      updateSelectedNames([])
      console.log('Clicked background')
    },
    attribution:
      'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  })

  // --- Load edges and positions ---
  // Load STG output converted to Cosmograph binaries
  // To generate these, run:
  //   python src/convert_graph_to_binary_pairs.py --input /absolute/path/to/stg_graph.graphml
  const { links, pointPositions, meta } = await loadCosmographData('/data/mm10_merged/', 'stg_graph')
  originalLinks = links
  graph.setPointPositions(pointPositions)
  graph.setLinks(links)
  // Ensure simulation runs at least once to bring points into view
  try { graph.start() } catch {}

  // If pseudotime is present, color points accordingly
  const pt: Array<number | null> | undefined = meta.pseudotime_norm || meta.pseudotime || undefined
  if (pt && Array.isArray(pt)) {
    const N = Math.floor(pointPositions.length / 2)
    const colors = new Float32Array((pt.length || N) * 4)
    const n = pt.length
    for (let i = 0; i < n; i++) {
      const tNorm = pt[i] == null ? null : Math.max(0, Math.min(1, Number(pt[i])))
      // Use bright yellow for missing pseudotime to ensure visibility on dark bg
      const [r, g, b, a] = tNorm == null ? [255, 220, 40, 255] : lerpBlueRed(tNorm)
      const o = i * 4
      colors[o] = r / 255
      colors[o + 1] = g / 255
      colors[o + 2] = b / 255
      colors[o + 3] = a / 255
    }
    ptColors = colors
    applyColoring()
  }
  else {
    // No pseudotime; default to uniform according to theme
    applyColoring()
  }
  graph.fitView()
  graph.render()

  // --- Function to update node name panel ---
  function updateSelectedNames(indices: number[]): void {
    if (!indices.length) {
      namesPanel.textContent = 'No selection'
      return
    }

    const shown = indices.slice(0, 50).map(i => {
      const name = meta.names?.[i] ?? `node_${i}`
      const ptVal = (meta.pseudotime_raw?.[i] ?? meta.pseudotime?.[i] ?? meta.pseudotime_norm?.[i])
      return ptVal == null ? `${name}` : `${name} (pt=${Number(ptVal).toFixed(3)})`
    })
    namesPanel.innerHTML = `
      <b>Selected ${indices.length} nodes</b><br>
      ${shown.join(', ')}${indices.length > 50 ? ', …' : ''}
    `
  }

  // --- UI Actions ---
  let isPaused = false
  const pauseButton = document.createElement('div')
  pauseButton.className = 'action'
  pauseButton.textContent = 'Pause'
  actionsDiv.appendChild(pauseButton)

  function pause(): void {
    isPaused = true
    pauseButton.textContent = 'Start'
    graph.pause()
  }

  function unpause(): void {
    isPaused = false
    pauseButton.textContent = 'Pause'
    if (graph.progress === 1) graph.start()
    else graph.unpause()
  }

  pauseButton.addEventListener('click', () => (isPaused ? unpause() : pause()))

  // Some event hooks may not be in the published TS types
  // @ts-ignore
  graph.setConfig({
    onSimulationEnd: (): void => pause(),
    // @ts-ignore
    onSelectionChange: (indices: number[]): void => updateSelectedNames(indices),
  })

  // --- Buttons: Fit, Zoom, Select ---
  function getRandomPointIndex(): number {
    return Math.floor((Math.random() * pointPositions.length) / 2)
  }

  function getRandomInRange([min, max]: [number, number]): number {
    return Math.random() * (max - min) + min
  }

  function fitView(): void {
    graph.fitView()
  }

  function zoomIn(): void {
    const pointIndex = getRandomPointIndex()
    graph.zoomToPointByIndex(pointIndex)
    graph.selectPointByIndex(pointIndex)
    updateSelectedNames([pointIndex])
    pause()
  }

  function selectPoint(): void {
    const pointIndex = getRandomPointIndex()
    graph.selectPointByIndex(pointIndex)
    graph.fitView()
    updateSelectedNames([pointIndex])
    pause()
  }

  function selectPointsInArea(): void {
    const w = div.clientWidth
    const h = div.clientHeight
    const left = getRandomInRange([w / 4, w / 2])
    const right = getRandomInRange([left, (w * 3) / 4])
    const top = getRandomInRange([h / 4, h / 2])
    const bottom = getRandomInRange([top, (h * 3) / 4])
    pause()
    graph.selectPointsInRect([
      [left, top],
      [right, bottom],
    ])
    // Use the public getter name if available
    // @ts-ignore
    const sel = typeof (graph as any).getSelectedIndices === 'function'
      ? (graph as any).getSelectedIndices()
      : // @ts-ignore legacy name
        (graph as any).getSelectedPointsIndices?.() ?? []
    updateSelectedNames(sel)
  }

  const buttons = [
    { label: 'Fit View', handler: fitView },
    { label: 'Zoom to a point', handler: zoomIn },
    { label: 'Select a point', handler: selectPoint },
    { label: 'Select points in area', handler: selectPointsInArea },
  ]

  for (const { label, handler } of buttons) {
    const btn = document.createElement('div')
    btn.className = 'action'
    btn.textContent = label
    btn.addEventListener('click', handler)
    actionsDiv.appendChild(btn)
  }

  return { div, graph }
}

// auto-run on load
graphmlViewer().then(({ div }) => {
  document.body.innerHTML = ''
  document.body.appendChild(div)
})

// --- Helpers ---
function lerpBlueRed(t: number): [number, number, number, number] {
  // Simple blue (low) -> red (high) gradient via RGB interpolation
  // low: #377eb8 (55,126,184), high: #e41a1c (228,26,28)
  const lb = [55, 126, 184]
  const hb = [228, 26, 28]
  const r = Math.round(lb[0] + (hb[0] - lb[0]) * t)
  const g = Math.round(lb[1] + (hb[1] - lb[1]) * t)
  const b = Math.round(lb[2] + (hb[2] - lb[2]) * t)
  return [r, g, b, 255]
}
