// Dashboard analítico: indicadores, gráficos e rankings

// ----------------------------------------
// DASHBOARD MODULE
// ----------------------------------------

async function refreshDashboard() {
  const period = document.getElementById('filter-period').value;
  const teamId = document.getElementById('filter-team').value;
  const consultantId = document.getElementById('filter-consultant').value;
  const channelId = document.getElementById('filter-channel').value;
  
  const { start_date, end_date } = getDateRangeForPeriod(period);

  if (!start_date || !end_date) return;

  try {
    let url = `/api/dashboard?start_date=${start_date}&end_date=${end_date}`;
    if (teamId) url += `&team_id=${teamId}`;
    if (consultantId) url += `&consultant_id=${consultantId}`;
    if (channelId) url += `&channel_id=${channelId}`;

    const data = await fetchWithAuth(url).then(r => r.json());

    // Update KPI UI
    document.getElementById('kpi-leads-totais').textContent = data.kpis.total_leads.toLocaleString('pt-BR');
    document.getElementById('kpi-leads-inviaveis').textContent = data.kpis.inviaveis.toLocaleString('pt-BR');
    document.getElementById('kpi-leads-inviaveis-label').textContent = `${data.kpis.percent_inviaveis.toFixed(2)}% dos leads recebidos`;
    document.getElementById('kpi-leads-aproveitaveis').textContent = data.kpis.aproveitaveis.toLocaleString('pt-BR');
    document.getElementById('kpi-fechados').textContent = data.kpis.fechados.toLocaleString('pt-BR');
    document.getElementById('kpi-conversao').textContent = data.kpis.conversao_reajustada.toFixed(2) + '%';

    // Build charts
    renderEvolutionChart(data.evolution);
    renderChannelChart(data.channelSplit);

    // Build ranking lists
    renderRankings(data.consultantsRanking, data.teamsRanking);

  } catch (err) {
    showToast("Erro ao obter dados analíticos.", "error");
    console.error(err);
  }
}

function renderEvolutionChart(evolutionData) {
  const ctx = document.getElementById('evolutionChart').getContext('2d');
  
  if (evolutionChartInstance) {
    evolutionChartInstance.destroy();
  }

  const labels = evolutionData.map(d => {
    // Format date YYYY-MM-DD to DD/MM
    const normalized = parseDateString(d.date);
    const pts = normalized.split('-');
    return pts.length === 3 ? `${pts[2]}/${pts[1]}` : d.date;
  });

  const leadsTotais = evolutionData.map(d => d.leads_totais);
  const fechados = evolutionData.map(d => d.fechados);
  const conversao = evolutionData.map(d => d.conversao_reajustada);

  evolutionChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Conversão Reajustada (%)',
          data: conversao,
          borderColor: 'rgb(0, 229, 229)',
          backgroundColor: 'rgba(0, 229, 229, 0.05)',
          borderWidth: 3,
          tension: 0.35,
          yAxisID: 'y1',
          fill: true
        },
        {
          label: 'Leads Recebidos',
          data: leadsTotais,
          borderColor: 'rgba(54, 162, 235, 0.5)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Vendas Fechadas',
          data: fechados,
          borderColor: 'rgb(153, 51, 255)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.1,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#a0aec0', font: { family: 'Montserrat', size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Montserrat' } }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Montserrat' } },
          title: { display: true, text: 'Quantidade (Absoluto)', color: '#a0aec0' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#00e5e5', font: { family: 'Montserrat', weight: 'bold' } },
          title: { display: true, text: 'Taxa de Conversão (%)', color: '#00e5e5' },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function renderChannelChart(channelData) {
  const ctx = document.getElementById('channelChart').getContext('2d');
  
  if (channelChartInstance) {
    channelChartInstance.destroy();
  }

  const labels = channelData.map(c => c.channel_name);
  const leads = channelData.map(c => c.leads_totais);
  const fechados = channelData.map(c => c.fechados);

  channelChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Leads Recebidos',
          data: leads,
          backgroundColor: 'rgba(0, 122, 255, 0.65)',
          borderColor: 'rgb(0, 122, 255)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Fechados (Vendas)',
          data: fechados,
          backgroundColor: 'rgba(36, 208, 96, 0.65)',
          borderColor: 'rgb(36, 208, 96)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y', // Horizontal bars
      plugins: {
        legend: {
          labels: { color: '#a0aec0', font: { family: 'Montserrat', size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Montserrat' } }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#a0aec0', font: { family: 'Montserrat' } }
        }
      }
    }
  });
}

function renderRankings(consultantsRank, teamsRank) {
  // 1. Consultants Ranking
  const cBody = document.getElementById('ranking-consultants-body');
  if (consultantsRank.length === 0) {
    cBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhum dado registrado no período.</td></tr>';
  } else {
    cBody.innerHTML = '';
    consultantsRank.forEach((item, index) => {
      const positionClass = index === 0 ? 'rank-1' : (index === 1 ? 'rank-2' : (index === 2 ? 'rank-3' : 'rank-other'));
      const positionLabel = index + 1;
      
      cBody.innerHTML += `
        <tr>
          <td><span class="rank-badge ${positionClass}">${positionLabel}</span></td>
          <td style="font-weight: 500;">${item.consultant_name}</td>
          <td><span class="badge info-badge">${item.team_name}</span></td>
          <td class="text-center">${item.leads_totais - item.inviaveis}</td>
          <td class="text-center text-cyan">${item.fechados}</td>
          <td class="text-right text-emerald">${item.conversao_reajustada.toFixed(2)}%</td>
        </tr>
      `;
    });
  }

  // 2. Teams Ranking
  const tBody = document.getElementById('ranking-teams-body');
  if (teamsRank.length === 0) {
    tBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum dado registrado no período.</td></tr>';
  } else {
    tBody.innerHTML = '';
    teamsRank.forEach((item, index) => {
      const positionClass = index === 0 ? 'rank-1' : (index === 1 ? 'rank-2' : (index === 2 ? 'rank-3' : 'rank-other'));
      const positionLabel = index + 1;
      
      tBody.innerHTML += `
        <tr>
          <td><span class="rank-badge ${positionClass}">${positionLabel}</span></td>
          <td style="font-weight: 500;">${item.team_name}</td>
          <td class="text-center">${item.leads_totais - item.inviaveis}</td>
          <td class="text-center text-cyan">${item.fechados}</td>
          <td class="text-right text-emerald">${item.conversao_reajustada.toFixed(2)}%</td>
        </tr>
      `;
    });
  }
}
