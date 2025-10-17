import { Graph } from '@cosmos.gl/graph'
import './style.css'

/**
 * Loads Cosmograph binary data and returns Float32Arrays.
 */
async function loadCosmographData(metaPath: string): Promise<{
  links: Float32Array
  pointPositions: Float32Array
  meta: any
}> {
  const meta = await fetch(metaPath).then(r => r.json())
  const edgesBuf = await fetch(`/data/${meta.edges_file}`).then(r => r.arrayBuffer())
  const posBuf = await fetch(`/data/${meta.positions_file}`).then(r => r.arrayBuffer())

  const links = new Float32Array(edgesBuf)
  const pointPositions = new Float32Array(posBuf)
  console.log(`Loaded ${meta.num_nodes} nodes and ${meta.num_edges} edges`)

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

  // --- Create Graph ---
  const graph = new Graph(graphDiv, {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    pointSize: 4,
    pointColor: '#4B5BBF',
    linkWidth: 0.6,
    linkColor: '#5F74C2',
    linkArrows: false,
    scalePointsOnZoom: true,
    linkGreyoutOpacity: 0,
    curvedLinks: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#4B5BBF',
    enableDrag: true,
    simulationLinkDistance: 1,
    simulationLinkSpring: 2,
    simulationRepulsion: 0.2,
    simulationGravity: 0.1,
    simulationDecay: 100000,
    onPointClick: (index: number): void => {
      graph.selectPointByIndex(index)
      graph.zoomToPointByIndex(index)
      console.log('Clicked point index:', index)
    },
    onBackgroundClick: (): void => {
      graph.unselectPoints()
      console.log('Clicked background')
    },
    attribution:
      'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  })

  // --- Load edges and positions ---
  const { links, pointPositions } = await loadCosmographData('/data/string_mouse_full_metadata.json')

  graph.setPointPositions(pointPositions)
  graph.setLinks(links)
  graph.fitView()
  graph.render()

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
    pause()
  }

  function selectPoint(): void {
    const pointIndex = getRandomPointIndex()
    graph.selectPointByIndex(pointIndex)
    graph.fitView()
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
