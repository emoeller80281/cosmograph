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

  // --- Overlay panel for node names ---
  const namesPanel = document.createElement('div')
  namesPanel.className = 'names-panel'
  namesPanel.textContent = 'No selection'
  div.appendChild(namesPanel)

  // --- Create Graph ---
  const graph = new Graph(graphDiv, {
    spaceSize: 8192,
    backgroundColor: '#ffffffff',
    pointSize: 6,
    pointColor: '#000000ff',
    linkWidth: 0.2,
    linkColor: '#43434334',
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
  const { links, pointPositions, meta } = await loadCosmographData(
    '/data/mm10_merged/',
    'mm10_merged_pkn'
  )
  graph.setPointPositions(pointPositions)
  graph.setLinks(links)
  graph.fitView()
  graph.render()

  // --- Function to update node name panel ---
  function updateSelectedNames(indices: number[]): void {
    if (!indices.length) {
      namesPanel.textContent = 'No selection'
      return
    }

    const shown = indices
      .slice(0, 50)
      .map(i => meta.names?.[i] ?? `node_${i}`)
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

  graph.setConfig({
    onSimulationEnd: (): void => pause(),
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
    updateSelectedNames(graph.getSelectedPointsIndices())
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
