// How many open jobs sit in each stage, as one colored bar with a legend.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { STAGES, STAGE_LABEL, jobStage, type Stage } from '../lib/stages'
import './pipeline-bar.css'

export function PipelineBar() {
  const { jobs, phases } = useData()
  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<Stage, number>
    let hold = 0
    for (const j of jobs) {
      if (j.status === 'on_hold') hold++
      else if (j.status === 'active') c[jobStage(phases, j.id).stage]++
    }
    return { c, hold, total: Object.values(c).reduce((a, b) => a + b, 0) }
  }, [jobs, phases])
  if (!counts.total && !counts.hold) return <p className="small muted">No open jobs yet.</p>
  return <div className="pipeline">
    <div className="pipeline-bar" role="img" aria-label={STAGES.map(s => `${counts.c[s]} ${STAGE_LABEL[s]}`).join(', ')}>
      {STAGES.filter(s => counts.c[s]).map(s => <span key={s} data-stage={s} style={{ flexGrow: counts.c[s] }} />)}
    </div>
    <ul className="pipeline-legend">
      {STAGES.map(s => <li key={s} data-stage={s}><Link to={`/jobs?stage=${s}`}><span className="dot" /><span className="grow">{STAGE_LABEL[s]}</span><strong className="num">{counts.c[s]}</strong></Link></li>)}
      {counts.hold > 0 && <li data-stage="hold"><Link to="/jobs?show=hold"><span className="dot" /><span className="grow">On hold</span><strong className="num">{counts.hold}</strong></Link></li>}
    </ul>
  </div>
}
