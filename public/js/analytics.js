const AnalyticsView = { charts: [] };

function destroyCharts() {
  AnalyticsView.charts.forEach(c => c.destroy());
  AnalyticsView.charts = [];
}

async function renderAnalytics(main) {
  if (!State.program) {
    main.innerHTML = `<div class="empty">No program loaded. Generate or open a program first.</div>`;
    return;
  }
  const p = State.program;
  main.innerHTML = `
    <h1>Analytics Dashboard</h1>
    <p class="subtitle">Program #${p.program_id} — ${p.sport}</p>
    <div id="analytics-content">Loading...</div>
  `;

  let data;
  try {
    data = await Api.getProgress(p.program_id);
  } catch (e) {
    document.getElementById('analytics-content').innerHTML = `<div class="empty">Could not load analytics.</div>`;
    return;
  }

  const exercises = Object.keys(data.exercise_trends);
  const content = document.getElementById('analytics-content');

  if (!data.total_sessions) {
    content.innerHTML = `<div class="empty">No sessions logged yet. Analytics will populate once you log workouts.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="grid cols-4">
      <div class="card stat-card"><div class="value">${data.total_sessions}</div><div class="label">Sessions Logged</div></div>
      <div class="card stat-card"><div class="value">${fmt(data.rpe_patterns.avg_actual_rpe)}</div><div class="label">Avg Actual RPE</div></div>
      <div class="card stat-card"><div class="value">${fmt(data.rpe_patterns.avg_prescribed_rpe)}</div><div class="label">Avg Prescribed RPE</div></div>
      <div class="card stat-card"><div class="value">${data.rpe_patterns.underreporting_flag ? 'Yes' : 'No'}</div><div class="label">Underreporting?</div></div>
    </div>

    <h2>Strength Progression (Estimated 1RM)</h2>
    <div class="card"><canvas id="chart-strength" height="90"></canvas></div>

    <h2>Weekly Volume Load</h2>
    <div class="card"><canvas id="chart-volume" height="90"></canvas></div>

    <h2>RPE: Prescribed vs Actual</h2>
    <div class="card"><canvas id="chart-rpe" height="90"></canvas></div>

    <h2>Week-over-Week Comparison</h2>
    <div class="card">
      <div class="grid cols-3">
        <div class="field"><label>Week 1</label><input id="cmp-w1" type="number" min="1" /></div>
        <div class="field"><label>Week 2</label><input id="cmp-w2" type="number" min="1" /></div>
        <div class="field" style="display:flex;align-items:flex-end"><button class="btn secondary" id="cmp-run">Compare</button></div>
      </div>
      <div id="cmp-result"></div>
    </div>

    <h2>Export</h2>
    <div class="card">
      <button class="btn secondary" id="export-csv">Export CSV</button>
      <button class="btn secondary" id="export-json">Export JSON</button>
    </div>
  `;

  destroyCharts();

  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];
  const strengthDatasets = exercises.map((ex, i) => ({
    label: ex,
    data: data.exercise_trends[ex].estimated_1rm_progression.map(pt => ({ x: pt.week, y: pt.e1rm })),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length],
    tension: 0.3
  })).filter(d => d.data.length);

  if (strengthDatasets.length) {
    const ctx = document.getElementById('chart-strength');
    AnalyticsView.charts.push(new Chart(ctx, {
      type: 'line',
      data: { datasets: strengthDatasets },
      options: chartOptions('Week', 'Est. 1RM (lbs)')
    }));
  }

  const volCtx = document.getElementById('chart-volume');
  AnalyticsView.charts.push(new Chart(volCtx, {
    type: 'bar',
    data: {
      labels: data.weekly_volume.map(w => `Wk ${w.week}`),
      datasets: [{ label: 'Volume Load', data: data.weekly_volume.map(w => w.volume_load), backgroundColor: '#3b82f6' }]
    },
    options: chartOptions('Week', 'Volume Load (lbs)')
  }));

  const rpeDatasets = exercises.map((ex, i) => {
    const rows = data.exercise_trends[ex].weekly_loads.filter(r => r.actual_rpe != null);
    return {
      label: ex,
      data: rows.map(r => ({ x: r.prescribed_rpe, y: r.actual_rpe })),
      backgroundColor: colors[i % colors.length]
    };
  }).filter(d => d.data.length);

  if (rpeDatasets.length) {
    const rpeCtx = document.getElementById('chart-rpe');
    AnalyticsView.charts.push(new Chart(rpeCtx, {
      type: 'scatter',
      data: { datasets: rpeDatasets },
      options: chartOptions('Prescribed RPE', 'Actual RPE')
    }));
  }

  document.getElementById('cmp-run').addEventListener('click', async () => {
    const w1 = document.getElementById('cmp-w1').value;
    const w2 = document.getElementById('cmp-w2').value;
    if (!w1 || !w2) return toast('Enter both weeks.');
    try {
      const cmp = await Api.compareWeeks(p.program_id, w1, w2);
      document.getElementById('cmp-result').innerHTML = `
        <div class="grid cols-2" style="margin-top:12px">
          <div><h3>Week ${cmp.week1.week}</h3>Volume: ${cmp.week1.volume_load} lbs<br/>Avg RPE: ${fmt(cmp.week1.avg_rpe)}<br/>Sessions: ${cmp.week1.sessions}</div>
          <div><h3>Week ${cmp.week2.week}</h3>Volume: ${cmp.week2.volume_load} lbs<br/>Avg RPE: ${fmt(cmp.week2.avg_rpe)}<br/>Sessions: ${cmp.week2.sessions}</div>
        </div>
        <p style="margin-top:10px">Volume change: <strong>${cmp.volume_change_pct != null ? cmp.volume_change_pct + '%' : 'N/A'}</strong></p>
      `;
    } catch (e) {
      toast(`Error: ${e.message}`);
    }
  });

  document.getElementById('export-csv').addEventListener('click', () => {
    window.open(`/api/export/${p.program_id}?format=csv`, '_blank');
  });
  document.getElementById('export-json').addEventListener('click', () => {
    window.open(`/api/export/${p.program_id}?format=json`, '_blank');
  });
}

function fmt(n) {
  return n == null ? 'N/A' : Math.round(n * 10) / 10;
}

function chartOptions(xLabel, yLabel) {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: '#e7ecf7' } } },
    scales: {
      x: { title: { display: true, text: xLabel, color: '#93a0bf' }, ticks: { color: '#93a0bf' }, grid: { color: '#223052' } },
      y: { title: { display: true, text: yLabel, color: '#93a0bf' }, ticks: { color: '#93a0bf' }, grid: { color: '#223052' } }
    }
  };
}
