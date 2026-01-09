import { Graph } from '@cosmos.gl/graph'
import './style.css'

/**
 * Loads Cosmograph binary data and returns Float32Arrays.
 */
async function loadCosmographData(
  dir: string,
  baseName: string
): Promise<{ links: Float32Array; pointPositions: Float32Array; meta: any; trajectoryLinks?: Float32Array; similarityLinks?: Float32Array }> {
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

  // Try to load separate edge files if available
  let trajectoryLinks: Float32Array | undefined
  let similarityLinks: Float32Array | undefined
  
  try {
    const trajPath = `${dir}${baseName}_edges_trajectory.bin`
    const simPath = `${dir}${baseName}_edges_similarity.bin`
    const [trajBuf, simBuf] = await Promise.all([
      fetch(trajPath).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
      fetch(simPath).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
    ])
    if (trajBuf) trajectoryLinks = new Float32Array(trajBuf)
    if (simBuf) similarityLinks = new Float32Array(simBuf)
  } catch (e) {
    // Fall back to combined edges
  }

  console.log(
    `Loaded ${meta.num_nodes ?? pointPositions.length / 2} nodes and ${
      meta.num_edges ?? links.length / 2
    } edges`
  )
  if (trajectoryLinks) console.log(`  - ${trajectoryLinks.length / 2} trajectory edges`)
  if (similarityLinks) console.log(`  - ${similarityLinks.length / 2} similarity edges`)

  return { links, pointPositions, meta, trajectoryLinks, similarityLinks }
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
    currentPointSize = v
    graph.setConfig({ pointSize: v })
    applyAttractorSizes()
    renderGraph()
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
  let trajectoryLinks: Float32Array | null = null
  let similarityLinks: Float32Array | null = null
  let minAttractorSize = 0
  let showTrajectoryEdges = true
  let showSimilarityEdges = true
  let linkWidth = 3.4
  let linkOpacity = 0.2
  type ColorMode = 'pseudotime' | 'condition_bias' | 'uniform'
  let colorMode: ColorMode = 'pseudotime'
  let conditionBiasColors: Float32Array | null = null
  let showAttractorPath = true
  let currentPathNodes: Set<number> | null = null
  let adjacencyList: Map<number, number[]> | null = null
  let currentPathEdges: Set<string> | null = null
  let baseLinks: Float32Array | null = null
  let filteredLinks: Float32Array | null = null
  let isPaused = false
  let isUpdatingPathSelection = false
  let nodeComponentSizeMap: Map<number, number> | null = null
  let attractorSizeMultiplier = 2.0
  let attractorNodeSet: Set<number> = new Set()
  let currentPointSize = 14
  let pointSizes: Float32Array | null = null

  function renderGraph(): void {
    graph.render()
    // Ensure pause state is preserved after render
    if (isPaused) {
      graph.pause()
    }
  }

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
    applyEdgeFiltering()
    renderGraph()
  }

  function applyColoring(): void {
    const N = Math.floor(pointPositions.length / 2)
    const darkBase = rgba('#00ff00ff') // vivid green on dark
    const lightBase = rgba('#000000ff') // black on light
    
    if (colorMode === 'pseudotime' && ptColors) {
      const colors = new Float32Array(ptColors)
      // Apply both path highlighting and component filtering
      for (let i = 0; i < N; i++) {
        // First check if node is filtered by component size
        if (nodeComponentSizeMap) {
          const size = nodeComponentSizeMap.get(i) || 0
          if (size < minAttractorSize) {
            colors[i * 4 + 3] = 0 // Hide filtered nodes completely
            continue
          }
        }
        // Then apply path highlighting
        if (showAttractorPath && currentPathNodes && !currentPathNodes.has(i)) {
          colors[i * 4 + 3] *= 0.1 // Reduce alpha to 10%
        }
      }
      // @ts-ignore
      if (typeof (graph as any).setPointColors === 'function') {
        // @ts-ignore
        ;(graph as any).setPointColors(colors)
      }
    } else if (colorMode === 'condition_bias' && conditionBiasColors) {
      const colors = new Float32Array(conditionBiasColors)
      // Apply both path highlighting and component filtering
      for (let i = 0; i < N; i++) {
        // First check if node is filtered by component size
        if (nodeComponentSizeMap) {
          const size = nodeComponentSizeMap.get(i) || 0
          if (size < minAttractorSize) {
            colors[i * 4 + 3] = 0 // Hide filtered nodes completely
            continue
          }
        }
        // Then apply path highlighting
        if (showAttractorPath && currentPathNodes && !currentPathNodes.has(i)) {
          colors[i * 4 + 3] *= 0.1 // Reduce alpha to 10%
        }
      }
      // @ts-ignore
      if (typeof (graph as any).setPointColors === 'function') {
        // @ts-ignore
        ;(graph as any).setPointColors(colors)
      }
    } else {
      // Uniform coloring
      const base = isDark ? darkBase : lightBase
      uniformColors = makeUniformColors(N, base)
      // Apply both path highlighting and component filtering
      for (let i = 0; i < N; i++) {
        // First check if node is filtered by component size
        if (nodeComponentSizeMap) {
          const size = nodeComponentSizeMap.get(i) || 0
          if (size < minAttractorSize) {
            uniformColors[i * 4 + 3] = 0 // Hide filtered nodes completely
            continue
          }
        }
        // Then apply path highlighting
        if (showAttractorPath && currentPathNodes && !currentPathNodes.has(i)) {
          uniformColors[i * 4 + 3] *= 0.1 // Reduce alpha to 10%
        }
      }
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
  colorCtl.style.display = 'flex'
  colorCtl.style.flexDirection = 'column'
  colorCtl.style.gap = '4px'
  
  const colorLabel = document.createElement('label')
  colorLabel.textContent = 'Color by:'
  colorLabel.style.fontWeight = 'bold'
  colorCtl.appendChild(colorLabel)
  
  const colorModes: Array<{value: ColorMode, label: string}> = [
    { value: 'pseudotime', label: 'Pseudotime' },
    { value: 'condition_bias', label: 'Condition bias (Healthy↔HIV)' },
    { value: 'uniform', label: 'Uniform color' }
  ]
  
  for (const mode of colorModes) {
    const radioWrapper = document.createElement('div')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'color-mode'
    radio.value = mode.value
    radio.id = `color-${mode.value}`
    radio.checked = colorMode === mode.value
    
    const label = document.createElement('label')
    label.htmlFor = `color-${mode.value}`
    label.textContent = mode.label
    label.style.marginLeft = '6px'
    
    radio.addEventListener('change', () => {
      if (radio.checked) {
        colorMode = mode.value
        applyColoring()
        renderGraph()
      }
    })
    
    radioWrapper.appendChild(radio)
    radioWrapper.appendChild(label)
    colorCtl.appendChild(radioWrapper)
  }
  
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

  // --- Link width control ---
  const linkWidthCtl = document.createElement('div')
  linkWidthCtl.className = 'action'
  const linkWidthLabel = document.createElement('label')
  linkWidthLabel.textContent = 'Link width'
  linkWidthLabel.style.marginRight = '8px'
  const linkWidthInput = document.createElement('input')
  linkWidthInput.type = 'range'
  linkWidthInput.min = '0.1'
  linkWidthInput.max = '10'
  linkWidthInput.step = '0.1'
  linkWidthInput.value = '3.4'
  linkWidthInput.style.verticalAlign = 'middle'
  const linkWidthValue = document.createElement('span')
  linkWidthValue.textContent = '3.4'
  linkWidthValue.style.marginLeft = '8px'
  linkWidthInput.addEventListener('input', () => {
    const v = Number(linkWidthInput.value)
    linkWidthValue.textContent = v.toFixed(1)
    linkWidth = v
    graph.setConfig({ linkWidth: v })
    renderGraph()
  })
  linkWidthCtl.appendChild(linkWidthLabel)
  linkWidthCtl.appendChild(linkWidthInput)
  linkWidthCtl.appendChild(linkWidthValue)
  actionsDiv.appendChild(linkWidthCtl)

  // --- Link opacity control ---
  const linkOpacityCtl = document.createElement('div')
  linkOpacityCtl.className = 'action'
  const linkOpacityLabel = document.createElement('label')
  linkOpacityLabel.textContent = 'Link opacity'
  linkOpacityLabel.style.marginRight = '8px'
  const linkOpacityInput = document.createElement('input')
  linkOpacityInput.type = 'range'
  linkOpacityInput.min = '0'
  linkOpacityInput.max = '1'
  linkOpacityInput.step = '0.05'
  linkOpacityInput.value = '0.2'
  linkOpacityInput.style.verticalAlign = 'middle'
  const linkOpacityValue = document.createElement('span')
  linkOpacityValue.textContent = '0.20'
  linkOpacityValue.style.marginLeft = '8px'
  linkOpacityInput.addEventListener('input', () => {
    const v = Number(linkOpacityInput.value)
    linkOpacityValue.textContent = v.toFixed(2)
    linkOpacity = v
    // Convert opacity to hex (0-255)
    const alphaHex = Math.round(v * 255).toString(16).padStart(2, '0')
    const linkColor = isDark ? `#6b7280${alphaHex}` : `#434343${alphaHex}`
    graph.setConfig({ linkColor })
    renderGraph()
  })
  linkOpacityCtl.appendChild(linkOpacityLabel)
  linkOpacityCtl.appendChild(linkOpacityInput)
  linkOpacityCtl.appendChild(linkOpacityValue)
  actionsDiv.appendChild(linkOpacityCtl)

  // --- Simulation controls ---
  const simHeader = document.createElement('div')
  simHeader.textContent = 'Simulation'
  simHeader.style.fontWeight = 'bold'
  simHeader.style.marginTop = '12px'
  simHeader.style.marginBottom = '4px'
  actionsDiv.appendChild(simHeader)

  // Link spring
  const springCtl = document.createElement('div')
  springCtl.className = 'action'
  const springLabel = document.createElement('label')
  springLabel.textContent = 'Link spring'
  springLabel.style.marginRight = '8px'
  const springInput = document.createElement('input')
  springInput.type = 'range'
  springInput.min = '0'
  springInput.max = '5'
  springInput.step = '0.1'
  springInput.value = '0.1'
  springInput.style.verticalAlign = 'middle'
  const springValue = document.createElement('span')
  springValue.textContent = '0.1'
  springValue.style.marginLeft = '8px'
  springInput.addEventListener('input', () => {
    const v = Number(springInput.value)
    springValue.textContent = v.toFixed(1)
    graph.setConfig({ simulationLinkSpring: v })
  })
  springCtl.appendChild(springLabel)
  springCtl.appendChild(springInput)
  springCtl.appendChild(springValue)
  actionsDiv.appendChild(springCtl)

  // Repulsion
  const repulsionCtl = document.createElement('div')
  repulsionCtl.className = 'action'
  const repulsionLabel = document.createElement('label')
  repulsionLabel.textContent = 'Repulsion'
  repulsionLabel.style.marginRight = '8px'
  const repulsionInput = document.createElement('input')
  repulsionInput.type = 'range'
  repulsionInput.min = '0'
  repulsionInput.max = '20'
  repulsionInput.step = '0.5'
  repulsionInput.value = '13.5'
  repulsionInput.style.verticalAlign = 'middle'
  const repulsionValue = document.createElement('span')
  repulsionValue.textContent = '13.5'
  repulsionValue.style.marginLeft = '8px'
  repulsionInput.addEventListener('input', () => {
    const v = Number(repulsionInput.value)
    repulsionValue.textContent = v.toFixed(1)
    graph.setConfig({ simulationRepulsion: v })
  })
  repulsionCtl.appendChild(repulsionLabel)
  repulsionCtl.appendChild(repulsionInput)
  repulsionCtl.appendChild(repulsionValue)
  actionsDiv.appendChild(repulsionCtl)

  // Gravity
  const gravityCtl = document.createElement('div')
  gravityCtl.className = 'action'
  const gravityLabel = document.createElement('label')
  gravityLabel.textContent = 'Gravity'
  gravityLabel.style.marginRight = '8px'
  const gravityInput = document.createElement('input')
  gravityInput.type = 'range'
  gravityInput.min = '0'
  gravityInput.max = '1'
  gravityInput.step = '0.05'
  gravityInput.value = '0.1'
  gravityInput.style.verticalAlign = 'middle'
  const gravityValue = document.createElement('span')
  gravityValue.textContent = '0.1'
  gravityValue.style.marginLeft = '8px'
  gravityInput.addEventListener('input', () => {
    const v = Number(gravityInput.value)
    gravityValue.textContent = v.toFixed(2)
    graph.setConfig({ simulationGravity: v })
  })
  gravityCtl.appendChild(gravityLabel)
  gravityCtl.appendChild(gravityInput)
  gravityCtl.appendChild(gravityValue)
  actionsDiv.appendChild(gravityCtl)

  // Friction
  const frictionCtl = document.createElement('div')
  frictionCtl.className = 'action'
  const frictionLabel = document.createElement('label')
  frictionLabel.textContent = 'Friction'
  frictionLabel.style.marginRight = '8px'
  const frictionInput = document.createElement('input')
  frictionInput.type = 'range'
  frictionInput.min = '0'
  frictionInput.max = '1'
  frictionInput.step = '0.05'
  frictionInput.value = '0.8'
  frictionInput.style.verticalAlign = 'middle'
  const frictionValue = document.createElement('span')
  frictionValue.textContent = '0.8'
  frictionValue.style.marginLeft = '8px'
  frictionInput.addEventListener('input', () => {
    const v = Number(frictionInput.value)
    frictionValue.textContent = v.toFixed(2)
    graph.setConfig({ simulationFriction: v })
  })
  frictionCtl.appendChild(frictionLabel)
  frictionCtl.appendChild(frictionInput)
  frictionCtl.appendChild(frictionValue)
  actionsDiv.appendChild(frictionCtl)

  // Center
  const centerCtl = document.createElement('div')
  centerCtl.className = 'action'
  const centerLabel = document.createElement('label')
  centerLabel.textContent = 'Center force'
  centerLabel.style.marginRight = '8px'
  const centerInput = document.createElement('input')
  centerInput.type = 'range'
  centerInput.min = '0'
  centerInput.max = '1'
  centerInput.step = '0.05'
  centerInput.value = '0.5'
  centerInput.style.verticalAlign = 'middle'
  const centerValue = document.createElement('span')
  centerValue.textContent = '0.5'
  centerValue.style.marginLeft = '8px'
  centerInput.addEventListener('input', () => {
    const v = Number(centerInput.value)
    centerValue.textContent = v.toFixed(2)
    graph.setConfig({ simulationCenter: v })
  })
  centerCtl.appendChild(centerLabel)
  centerCtl.appendChild(centerInput)
  centerCtl.appendChild(centerValue)
  actionsDiv.appendChild(centerCtl)

  // --- Toggle edge types ---
  const trajEdgeCtl = document.createElement('div')
  trajEdgeCtl.className = 'action'
  const trajEdgeChk = document.createElement('input')
  trajEdgeChk.type = 'checkbox'
  trajEdgeChk.checked = true
  trajEdgeChk.id = 'show-traj-edges'
  const trajEdgeLbl = document.createElement('label')
  trajEdgeLbl.htmlFor = 'show-traj-edges'
  trajEdgeLbl.textContent = 'Show trajectory edges'
  trajEdgeLbl.style.marginLeft = '8px'
  trajEdgeChk.addEventListener('change', () => {
    showTrajectoryEdges = trajEdgeChk.checked
    applyFiltering()
  })
  trajEdgeCtl.appendChild(trajEdgeChk)
  trajEdgeCtl.appendChild(trajEdgeLbl)
  actionsDiv.appendChild(trajEdgeCtl)

  const simEdgeCtl = document.createElement('div')
  simEdgeCtl.className = 'action'
  const simEdgeChk = document.createElement('input')
  simEdgeChk.type = 'checkbox'
  simEdgeChk.checked = true
  simEdgeChk.id = 'show-sim-edges'
  const simEdgeLbl = document.createElement('label')
  simEdgeLbl.htmlFor = 'show-sim-edges'
  simEdgeLbl.textContent = 'Show similarity edges'
  simEdgeLbl.style.marginLeft = '8px'
  simEdgeChk.addEventListener('change', () => {
    showSimilarityEdges = simEdgeChk.checked
    applyFiltering()
  })
  simEdgeCtl.appendChild(simEdgeChk)
  simEdgeCtl.appendChild(simEdgeLbl)
  actionsDiv.appendChild(simEdgeCtl)

  // --- Toggle attractor path highlighting ---
  const pathCtl = document.createElement('div')
  pathCtl.className = 'action'
  const pathChk = document.createElement('input')
  pathChk.type = 'checkbox'
  pathChk.checked = true
  pathChk.id = 'show-attractor-path'
  const pathLbl = document.createElement('label')
  pathLbl.htmlFor = 'show-attractor-path'
  pathLbl.textContent = 'Highlight path to attractor'
  pathLbl.style.marginLeft = '8px'
  pathChk.addEventListener('change', () => {
    showAttractorPath = pathChk.checked
    if (!showAttractorPath) {
      currentPathNodes = null
    }
    // Re-trigger selection update to apply path highlighting
    // @ts-ignore
    const sel = typeof (graph as any).getSelectedIndices === 'function'
      ? (graph as any).getSelectedIndices()
      : // @ts-ignore legacy name
        (graph as any).getSelectedPointsIndices?.() ?? []
    updateSelectedNames(sel)
  })
  pathCtl.appendChild(pathChk)
  pathCtl.appendChild(pathLbl)
  actionsDiv.appendChild(pathCtl)

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

  // --- Attractor size multiplier control ---
  const attractorSizeCtl = document.createElement('div')
  attractorSizeCtl.className = 'action'
  const attractorSizeLabel = document.createElement('label')
  attractorSizeLabel.textContent = 'Attractor size multiplier'
  attractorSizeLabel.style.marginRight = '8px'
  const attractorSizeInput = document.createElement('input')
  attractorSizeInput.type = 'range'
  attractorSizeInput.min = '1'
  attractorSizeInput.max = '5'
  attractorSizeInput.value = '2'
  attractorSizeInput.step = '0.1'
  attractorSizeInput.style.verticalAlign = 'middle'
  const attractorSizeValue = document.createElement('span')
  attractorSizeValue.textContent = '2.0'
  attractorSizeValue.style.marginLeft = '8px'
  attractorSizeInput.addEventListener('input', () => {
    const v = Number(attractorSizeInput.value)
    attractorSizeValue.textContent = v.toFixed(1)
    attractorSizeMultiplier = v
    applyAttractorSizes()
    renderGraph()
  })
  attractorSizeCtl.appendChild(attractorSizeLabel)
  attractorSizeCtl.appendChild(attractorSizeInput)
  attractorSizeCtl.appendChild(attractorSizeValue)
  actionsDiv.appendChild(attractorSizeCtl)

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

  function buildAdjacencyList(): void {
    if (!originalLinks) return
    
    // Build directed adjacency list from trajectory edges only
    adjacencyList = new Map<number, number[]>()
    const edgesToUse = trajectoryLinks || originalLinks
    
    for (let i = 0; i < edgesToUse.length; i += 2) {
      const src = Math.floor(edgesToUse[i])
      const dst = Math.floor(edgesToUse[i + 1])
      if (!adjacencyList.has(src)) {
        adjacencyList.set(src, [])
      }
      adjacencyList.get(src)!.push(dst)
    }
    console.log('Built adjacency list with', adjacencyList.size, 'source nodes')
  }

  function identifyAttractorsAndApplySizes(): void {
    if (!adjacencyList || !pointPositions) return
    
    const numNodes = Math.floor(pointPositions.length / 2)
    attractorNodeSet.clear()
    
    // Identify attractors: nodes with no outgoing edges
    for (let i = 0; i < numNodes; i++) {
      const outgoing = adjacencyList.get(i)
      if (!outgoing || outgoing.length === 0) {
        attractorNodeSet.add(i)
      }
    }
    
    console.log(`Identified ${attractorNodeSet.size} attractors`)
    applyAttractorSizes()
  }
  
  function applyAttractorSizes(): void {
    if (!pointPositions) return
    
    const numNodes = Math.floor(pointPositions.length / 2)
    
    // Check if Cosmograph supports setPointSizes
    if (typeof (graph as any).setPointSizes === 'function') {
      const sizes = new Float32Array(numNodes)
      for (let i = 0; i < numNodes; i++) {
        sizes[i] = attractorNodeSet.has(i) ? currentPointSize * attractorSizeMultiplier : currentPointSize
      }
      pointSizes = sizes
      ;(graph as any).setPointSizes(sizes)
    }
  }
  
  function findPathToAttractor(startNode: number): number[] {
    if (!adjacencyList) {
      buildAdjacencyList()
    }
    if (!adjacencyList) return [startNode]
    
    const path: number[] = [startNode]
    const visited = new Set<number>([startNode])
    let current = startNode
    
    // Follow the directed edges until we reach a node with no outgoing edges (attractor)
    // or we hit a cycle
    while (true) {
      const neighbors = adjacencyList.get(current)
      if (!neighbors || neighbors.length === 0) {
        // Reached an attractor (no outgoing edges)
        break
      }
      
      // Take the first outgoing edge (for multiple edges, could use other logic)
      const next = neighbors[0]
      
      if (visited.has(next)) {
        // Hit a cycle - the cycle itself is the attractor
        break
      }
      
      path.push(next)
      visited.add(next)
      current = next
    }
    
    return path
  }

  function applyEdgeFiltering(): void {
    if (!baseLinks) return
    
    // Use filtered links if component filtering is active, otherwise use base links
    const linksToUse = filteredLinks || baseLinks
    graph.setLinks(linksToUse)
    
    if (showAttractorPath && currentPathEdges && currentPathEdges.size > 0) {
      // Increase edge visibility significantly so path edges (connecting bright nodes) are clearly visible
      // But make non-selected edges very faint
      graph.setConfig({ 
        linkWidth: linkWidth * 3,
        linkColor: isDark ? '#6b7280aa' : '#434343aa', // Much more opaque
        linkGreyoutOpacity: 0.05 // Very faint for non-path edges
      })
      
      console.log(`Path highlighting active with ${currentPathEdges.size} edges in path`)
    } else {
      // Normal edge styling
      graph.setConfig({ 
        linkWidth: linkWidth,
        linkColor: isDark ? '#6b728033' : '#43434334',
        linkGreyoutOpacity: 0.5 // Normal visibility when not highlighting path
      })
    }
  }

  function applyFiltering(): void {
    if (!originalLinks) {
      applyColoring()
      applyEdgeFiltering()
      renderGraph()
      return
    }
    
    const numNodes = Math.floor(pointPositions.length / 2)
    
    // Build edge list based on user toggles
    let activeEdges = originalLinks
    if (trajectoryLinks && similarityLinks) {
      // Use a Set to deduplicate edges
      const edgeSet = new Set<string>()
      const combined: number[] = []
      
      if (showTrajectoryEdges) {
        for (let i = 0; i < trajectoryLinks.length; i += 2) {
          const src = trajectoryLinks[i]
          const dst = trajectoryLinks[i + 1]
          const key = `${src}-${dst}`
          if (!edgeSet.has(key)) {
            edgeSet.add(key)
            combined.push(src, dst)
          }
        }
      }
      if (showSimilarityEdges) {
        for (let i = 0; i < similarityLinks.length; i += 2) {
          const src = similarityLinks[i]
          const dst = similarityLinks[i + 1]
          const key = `${src}-${dst}`
          if (!edgeSet.has(key)) {
            edgeSet.add(key)
            combined.push(src, dst)
          }
        }
      }
      activeEdges = new Float32Array(combined)
      console.log(`Active edges: ${activeEdges.length / 2} (traj: ${showTrajectoryEdges ? trajectoryLinks.length / 2 : 0}, sim: ${showSimilarityEdges ? similarityLinks.length / 2 : 0}, deduped: ${edgeSet.size})`)
    }
    
    // Update baseLinks with the active edge set (before component filtering)
    baseLinks = activeEdges
    
    // If min component size is 1 (no filtering), clear filteredLinks
    if (minAttractorSize <= 1) {
      filteredLinks = null
      nodeComponentSizeMap = null
      graph.setLinks(baseLinks)
      applyColoring()
      applyEdgeFiltering()
      renderGraph()
      return
    }
    
    // Find connected components in the active graph
    const nodeToComponentSize = findConnectedComponents(numNodes, activeEdges)
    nodeComponentSizeMap = nodeToComponentSize
    
    // Filter edges: keep only edges where both nodes are in large enough components
    const filteredEdges: number[] = []
    for (let i = 0; i < activeEdges.length; i += 2) {
      const src = Math.floor(activeEdges[i])
      const dst = Math.floor(activeEdges[i + 1])
      const srcSize = nodeToComponentSize.get(src) || 0
      const dstSize = nodeToComponentSize.get(dst) || 0
      
      if (srcSize >= minAttractorSize && dstSize >= minAttractorSize) {
        filteredEdges.push(activeEdges[i], activeEdges[i + 1])
      }
    }
    
    const newLinks = new Float32Array(filteredEdges)
    filteredLinks = newLinks
    graph.setLinks(newLinks)
    
    // Update colors to hide filtered nodes
    applyColoringWithFilter(nodeToComponentSize)
    applyEdgeFiltering()
    renderGraph()
  }

  function applyColoringWithFilter(nodeToComponentSize: Map<number, number>): void {
    const N = Math.floor(pointPositions.length / 2)
    const darkBase = rgba('#00ff00ff')
    const lightBase = rgba('#000000ff')
    
    if (colorMode === 'pseudotime' && ptColors) {
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
    } else if (colorMode === 'condition_bias' && conditionBiasColors) {
      const filtered = new Float32Array(conditionBiasColors)
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
    linkWidth: 3.4,
    linkColor: '#6b728033',
    linkArrows: true,
    scalePointsOnZoom: true,
    linkGreyoutOpacity: 0.5,
    curvedLinks: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#4B5BBF',
    enableDrag: true,
    enableRightClickRepulsion: true,
    simulationRepulsionFromMouse: 5,
    simulationLinkDistance: 2,
    simulationLinkSpring: 0.1,
    simulationRepulsion: 13.5,
    simulationCenter: 0.5,
    simulationGravity: 0.1,
    simulationFriction: 0.8,
    simulationCluster: 1,
    simulationDecay: 100000,
    onPointClick: (index: number): void => {
      // Prevent selection of filtered nodes
      if (nodeComponentSizeMap) {
        const size = nodeComponentSizeMap.get(index) || 0
        if (size < minAttractorSize) {
          console.log(`Ignoring click on filtered node ${index} (component size: ${size})`)
          return
        }
      }
      
      const wasPaused = isPaused
      graph.selectPointByIndex(index)
      graph.zoomToPointByIndex(index)
      updateSelectedNames([index])
      // If simulation was paused before click, keep it paused
      if (wasPaused) {
        graph.pause()
      }
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
  // Load STG output with similarity edges
  // To generate these, run:
  //   python src/convert_graph_to_binary_pairs.py --input /absolute/path/to/stg_graph_with_similarity.graphml
  const { links, pointPositions, meta, trajectoryLinks: tLinks, similarityLinks: sLinks } = await loadCosmographData('/data/mm10_merged/', 'stg_graph_with_similarity')
  originalLinks = links
  trajectoryLinks = tLinks || null
  similarityLinks = sLinks || null
  
  console.log('Edge arrays loaded:')
  console.log('  Total edges:', originalLinks?.length / 2)
  console.log('  Trajectory edges:', trajectoryLinks?.length ? trajectoryLinks.length / 2 : 'none')
  console.log('  Similarity edges:', similarityLinks?.length ? similarityLinks.length / 2 : 'none')
  
  graph.setPointPositions(pointPositions)
  graph.setLinks(links)
  baseLinks = links
  // Build adjacency list for path finding
  buildAdjacencyList()
  // Identify attractors and apply size variations
  identifyAttractorsAndApplySizes()
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
  }
  
  // If condition_bias is present, compute separate color array
  const cb: Array<number | null> | undefined = meta.condition_bias_norm || undefined
  if (cb && Array.isArray(cb)) {
    const N = Math.floor(pointPositions.length / 2)
    const colors = new Float32Array((cb.length || N) * 4)
    const n = cb.length
    for (let i = 0; i < n; i++) {
      const biasNorm = cb[i] == null ? null : Math.max(0, Math.min(1, Number(cb[i])))
      // Blue (Healthy=-1) -> White (Mixed=0) -> Red (HIV=+1)
      const [r, g, b, a] = biasNorm == null ? [255, 220, 40, 255] : lerpHealthyHIV(biasNorm)
      const o = i * 4
      colors[o] = r / 255
      colors[o + 1] = g / 255
      colors[o + 2] = b / 255
      colors[o + 3] = a / 255
    }
    conditionBiasColors = colors
  }
  
  applyColoring()
  graph.fitView()
  renderGraph()

  // --- Function to update node name panel ---
  function updateSelectedNames(indices: number[]): void {
    // Prevent recursive updates when we're selecting path nodes
    if (isUpdatingPathSelection) return
    
    if (!indices.length) {
      namesPanel.textContent = 'No selection'
      currentPathNodes = null
      currentPathEdges = null
      if (showAttractorPath) {
        applyColoring()
        applyEdgeFiltering()
        renderGraph()
      }
      return
    }

    const shown = indices.slice(0, 50).map(i => {
      const name = meta.names?.[i] ?? `node_${i}`
      const ptVal = (meta.pseudotime_raw?.[i] ?? meta.pseudotime?.[i] ?? meta.pseudotime_norm?.[i])
      const ptStr = ptVal == null ? '' : ` (pt=${Number(ptVal).toFixed(3)})`
      return `ID: ${i}, ${name}${ptStr}`
    })
    
    let pathInfo = ''
    if (showAttractorPath && indices.length === 1 && !isUpdatingPathSelection) {
      const path = findPathToAttractor(indices[0])
      if (path.length > 1) {
        const attractorId = path[path.length - 1]
        const attractorName = meta.names?.[attractorId] ?? `node_${attractorId}`
        pathInfo = `<br><span style="color: #4B5BBF;">Path to attractor ${attractorName} (ID: ${attractorId}): ${path.length} nodes</span>`
        currentPathNodes = new Set(path)
        
        // Build set of edges in the path
        currentPathEdges = new Set()
        for (let i = 0; i < path.length - 1; i++) {
          const edgeKey = `${path[i]}-${path[i + 1]}`
          currentPathEdges.add(edgeKey)
        }
        
        // Select ALL nodes in the path so edges between them are highlighted
        isUpdatingPathSelection = true
        graph.unselectPoints()
        // @ts-ignore - selectPointsByIndices might not be in types
        if (typeof graph.selectPointsByIndices === 'function') {
          // @ts-ignore
          graph.selectPointsByIndices(path)
        } else {
          // Fallback: select one by one
          for (const nodeId of path) {
            graph.selectPointByIndex(nodeId, true, false)
          }
        }
        isUpdatingPathSelection = false
        
        applyColoring()
        applyEdgeFiltering()
        renderGraph()
      } else {
        pathInfo = '<br><span style="color: #999;">Node is an attractor (no outgoing edges)</span>'
        currentPathNodes = new Set([indices[0]])
        currentPathEdges = null
        applyColoring()
        applyEdgeFiltering()
        renderGraph()
      }
    } else if (showAttractorPath) {
      currentPathNodes = null
      currentPathEdges = null
      applyColoring()
      applyEdgeFiltering()
      renderGraph()
    }
    
    namesPanel.innerHTML = `
      <b>Selected ${indices.length} node${indices.length > 1 ? 's' : ''}</b><br>
      ${shown.join(', ')}${indices.length > 50 ? ', …' : ''}${pathInfo}
    `
  }

  // --- UI Actions ---
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
  }

  function selectPoint(): void {
    const pointIndex = getRandomPointIndex()
    graph.selectPointByIndex(pointIndex)
    graph.fitView()
    updateSelectedNames([pointIndex])
  }

  function selectPointsInArea(): void {
    const w = div.clientWidth
    const h = div.clientHeight
    const left = getRandomInRange([w / 4, w / 2])
    const right = getRandomInRange([left, (w * 3) / 4])
    const top = getRandomInRange([h / 4, h / 2])
    const bottom = getRandomInRange([top, (h * 3) / 4])
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

function lerpHealthyHIV(t: number): [number, number, number, number] {
  // Blue (Healthy, -1) -> Red (HIV, +1)
  // t=0 (bias=-1, Healthy): #377eb8 (55,126,184)
  // t=1 (bias=+1, HIV): #e41a1c (228,26,28)
  const blue = [55, 126, 184]
  const red = [228, 26, 28]
  const r = Math.round(blue[0] + (red[0] - blue[0]) * t)
  const g = Math.round(blue[1] + (red[1] - blue[1]) * t)
  const b = Math.round(blue[2] + (red[2] - blue[2]) * t)
  return [r, g, b, 255]
}
