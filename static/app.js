(function () {
    'use strict';

    const LEAGUE_GROUPS = [
        { label: 'Tier 1', leagues: ['LCK', 'LPL', 'LEC', 'LTA N', 'LCS', 'LTA'], defaultChecked: true },
        { label: 'Academy', leagues: ['LCKC', 'LPLOL', 'KeSPA'], defaultChecked: true },
        { label: 'Tier 2', leagues: ['PCS', 'VCS', 'LCP', 'LJL', 'LTA S', 'CBLOL', 'TCL'], defaultChecked: true },
        { label: 'Regional', leagues: ['LFL', 'PRM', 'NLC', 'LVP SL', 'EM', 'LAS', 'NACL'], defaultChecked: true },
        { label: 'Junk', leagues: ['LFL2', 'PRMP', 'AL', 'HLL', 'EBL', 'LIT', 'RL', 'ROL', 'LES', 'HM', 'HW', 'NEXO', 'CT', 'LRN', 'LRS', 'CD', 'FST', 'ASI', 'CCWS', 'HC'], defaultChecked: false },
        { label: 'International', leagues: ['MSI', 'WLDs', 'EWC', 'DCup', 'Asia Master', 'IC', 'Americas Cup'], defaultChecked: false },
    ];

    const state = {
        ac: null,
        results: null,
        expandedGame: null,
        detailCache: {},
    };

    // ── Toast ──
    let toastTimer;
    function toast(msg, type) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.className = 'toast ' + (type || '') + ' show';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
    }

    // ── Autocomplete ──
    function setupAutocomplete(input, getSource, onSelect) {
        const wrap = document.createElement('div');
        wrap.className = 'ac-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const dd = document.createElement('div');
        dd.className = 'ac-dropdown';
        wrap.appendChild(dd);

        let hlIdx = -1;
        let items = [];

        function render(filtered) {
            items = filtered.slice(0, 12);
            hlIdx = -1;
            dd.innerHTML = items.map((s, i) =>
                `<div class="ac-option" data-idx="${i}">${s}</div>`
            ).join('');
            dd.classList.toggle('open', items.length > 0);
        }

        function highlight(idx) {
            dd.querySelectorAll('.ac-option').forEach((el, i) => {
                el.classList.toggle('highlighted', i === idx);
                if (i === idx) el.scrollIntoView({ block: 'nearest' });
            });
            hlIdx = idx;
        }

        function select(val) {
            input.value = val;
            dd.classList.remove('open');
            if (onSelect) onSelect(val, input);
        }

        input.addEventListener('input', () => {
            const val = input.value.toLowerCase().trim();
            if (!val) { dd.classList.remove('open'); return; }
            const source = getSource();
            const filtered = source.filter(s => s.toLowerCase().includes(val));
            render(filtered);
        });

        input.addEventListener('keydown', (e) => {
            if (!dd.classList.contains('open')) {
                // Only fire matchup search when the input is actually a matchup
                // champ-input — scaling pickers and other consumers shouldn't
                // trigger an unrelated search.
                if (e.key === 'Enter' && input.classList.contains('champ-input')) {
                    e.preventDefault();
                    document.getElementById('btn-search').click();
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlight(Math.min(hlIdx + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                highlight(Math.max(hlIdx - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (hlIdx >= 0 && items[hlIdx]) {
                    select(items[hlIdx]);
                } else if (items.length > 0) {
                    select(items[0]);
                }
            } else if (e.key === 'Tab') {
                if (items.length > 0) {
                    e.preventDefault();
                    select(hlIdx >= 0 ? items[hlIdx] : items[0]);
                }
            } else if (e.key === 'Escape') {
                dd.classList.remove('open');
            }
        });

        dd.addEventListener('mousedown', (e) => {
            const opt = e.target.closest('.ac-option');
            if (opt) {
                e.preventDefault();
                select(opt.textContent);
            }
        });

        let blurTimer;
        input.addEventListener('blur', () => {
            blurTimer = setTimeout(() => dd.classList.remove('open'), 120);
        });
        input.addEventListener('focus', () => clearTimeout(blurTimer));
    }

    // ── League filter (grouped checkboxes) ──
    function setupLeagueFilter() {
        const container = document.getElementById('league-checkboxes');
        const available = new Set(state.ac ? state.ac.leagues : []);
        const placed = new Set();

        let html = '';
        for (const group of LEAGUE_GROUPS) {
            const groupLeagues = group.leagues.filter(l => available.has(l));
            if (!groupLeagues.length) continue;
            groupLeagues.forEach(l => placed.add(l));
            const chk = group.defaultChecked ? 'checked' : '';
            html += `<div class="league-group" data-group="${group.label}">
                <label class="league-group-header">
                    <input type="checkbox" class="group-toggle" ${chk}>
                    <span>${group.label}</span>
                </label>
                <div class="league-group-items">
                    ${groupLeagues.map(l =>
                        `<label class="league-cb"><input type="checkbox" value="${l}" ${chk}><span>${l}</span></label>`
                    ).join('')}
                </div>
            </div>`;
        }

        // Any leftovers
        const leftover = [...available].filter(l => !placed.has(l)).sort();
        if (leftover.length) {
            html += `<div class="league-group" data-group="Other">
                <label class="league-group-header">
                    <input type="checkbox" class="group-toggle" checked>
                    <span>Other</span>
                </label>
                <div class="league-group-items">
                    ${leftover.map(l =>
                        `<label class="league-cb"><input type="checkbox" value="${l}" checked><span>${l}</span></label>`
                    ).join('')}
                </div>
            </div>`;
        }

        container.innerHTML = html;

        // Group toggle: check/uncheck all in group
        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('group-toggle')) {
                const group = e.target.closest('.league-group');
                group.querySelectorAll('.league-group-items input[type="checkbox"]').forEach(
                    cb => cb.checked = e.target.checked
                );
            } else {
                // Sync group header with children
                const group = e.target.closest('.league-group');
                if (group) {
                    const boxes = group.querySelectorAll('.league-group-items input[type="checkbox"]');
                    const allChecked = [...boxes].every(cb => cb.checked);
                    group.querySelector('.group-toggle').checked = allChecked;
                }
            }
        });
    }

    function getSelectedLeagues() {
        const boxes = document.querySelectorAll('#league-checkboxes .league-group-items input[type="checkbox"]');
        const all = [], checked = [];
        boxes.forEach(cb => { all.push(cb.value); if (cb.checked) checked.push(cb.value); });
        return checked.length === all.length ? [] : checked;
    }

    function getSelectedYears() {
        return [...document.querySelectorAll('.year-cb:checked')].map(cb => cb.value);
    }

    // ── Search ──
    async function onSearch() {
        const teamA = [], teamB = [];
        document.querySelectorAll('#team-a-champs .champ-input').forEach(inp => {
            if (inp.value.trim()) teamA.push(inp.value.trim());
        });
        document.querySelectorAll('#team-b-champs .champ-input').forEach(inp => {
            if (inp.value.trim()) teamB.push(inp.value.trim());
        });

        if (!teamA.length && !teamB.length) {
            toast('Enter at least one champion', 'error');
            return;
        }

        const btn = document.getElementById('btn-search');
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span> Searching...';

        try {
            const resp = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    team_a: teamA,
                    team_b: teamB,
                    leagues: getSelectedLeagues(),
                    years: getSelectedYears(),
                }),
            });
            const data = await resp.json();

            if (!resp.ok) {
                toast(data.error || 'Search failed', 'error');
                return;
            }

            state.results = data;
            state.expandedGame = null;
            state.detailCache = {};
            renderSummary(data);
            renderResults(data);
            document.getElementById('btn-discord').disabled = !data.total;
        } catch (err) {
            toast('Network error', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Search';
        }
    }

    // ── Render Summary ──
    function renderSummary(data) {
        const el = document.getElementById('summary');
        el.classList.remove('hidden');

        document.getElementById('stat-total').textContent = data.total;
        document.getElementById('stat-a-label').textContent = data.team_a_label;
        document.getElementById('stat-b-label').textContent = data.team_b_label;

        const aWr = data.team_a_wr;
        const bWr = data.total ? Math.round((100 - aWr) * 10) / 10 : 0;

        const aEl = document.getElementById('stat-a-wr');
        aEl.textContent = aWr + '%';
        aEl.className = 'stat-value ' + (aWr > 50 ? 'positive' : aWr < 50 ? 'negative' : 'neutral');

        const bEl = document.getElementById('stat-b-wr');
        bEl.textContent = bWr + '%';
        bEl.className = 'stat-value ' + (bWr > 50 ? 'positive' : bWr < 50 ? 'negative' : 'neutral');

        // Normalized (log-odds adjusted) WR — excludes international games
        const normA = document.getElementById('stat-a-norm');
        const normB = document.getElementById('stat-b-norm');
        if (data.norm_total > 0 && data.normalized_wr !== null) {
            const nA = data.normalized_wr;
            const nB = Math.round((100 - nA) * 10) / 10;
            normA.textContent = nA + '%';
            normA.className = 'stat-value adjusted ' + (nA > 50 ? 'positive' : nA < 50 ? 'negative' : 'neutral');
            normB.textContent = nB + '%';
            normB.className = 'stat-value adjusted ' + (nB > 50 ? 'positive' : nB < 50 ? 'negative' : 'neutral');
            const tip = `Adjusted for team strength (log-odds, ${data.norm_total} non-intl games). What the WR would be if both sides had equally skilled teams.`;
            normA.title = tip;
            normB.title = tip;
        } else {
            normA.textContent = '—';
            normA.className = 'stat-value adjusted neutral';
            normB.textContent = '—';
            normB.className = 'stat-value adjusted neutral';
        }
    }

    // ── Render Results Table ──
    function renderResults(data) {
        const panel = document.getElementById('results-panel');
        const tbody = document.getElementById('results-body');
        panel.classList.remove('hidden');

        if (!data.games.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No games found</td></tr>';
            return;
        }

        tbody.innerHTML = data.games.map(g => `
            <tr data-gameid="${g.gameid}" data-a-side="${g.team_a_side}">
                <td>${g.date}</td>
                <td>${g.league}</td>
                <td>${g.patch}</td>
                <td class="al">${g.team_a_name}${renderYearWr(g.team_a_year_wr)}</td>
                <td class="al">${g.team_b_name}${renderYearWr(g.team_b_year_wr)}</td>
                <td><span class="${g.team_a_win ? 'result-w' : 'result-l'}">${g.team_a_win ? 'W' : 'L'}</span></td>
                <td>${g.total_kills}</td>
                <td>${g.gamelength}</td>
            </tr>
        `).join('');
    }

    // Tiny WR badge shown next to each team name in the results table.
    // Color reflects strength (>50 emerald, <50 red, =50 muted). Hidden gracefully
    // if the team has no regional games for that year.
    function renderYearWr(rec) {
        if (!rec) return '';
        const cls = rec.wr > 50 ? 'pos' : rec.wr < 50 ? 'neg' : 'neu';
        const tip = `${rec.year} regional WR — ${rec.wins}W / ${rec.games - rec.wins}L (${rec.games} games)`;
        return ` <span class="team-wr ${cls}" title="${tip}">${rec.wr}%</span>`;
    }

    // ── Expandable Detail ──
    async function toggleDetail(gameid, row) {
        // Collapse existing
        const existing = document.querySelector('.game-detail-row');
        if (existing) {
            const prevId = existing.dataset.gameid;
            existing.remove();
            document.querySelectorAll('.dtable tbody tr.expanded').forEach(r => r.classList.remove('expanded'));
            if (prevId === gameid) {
                state.expandedGame = null;
                return;
            }
        }

        row.classList.add('expanded');
        state.expandedGame = gameid;

        // Insert loading row
        const detailTr = document.createElement('tr');
        detailTr.className = 'game-detail-row';
        detailTr.dataset.gameid = gameid;
        detailTr.innerHTML = '<td colspan="8"><div class="game-detail"><div class="empty-state">Loading...</div></div></td>';
        row.after(detailTr);

        // Fetch or use cache
        let detail = state.detailCache[gameid];
        if (!detail) {
            try {
                const resp = await fetch('/api/game/' + encodeURIComponent(gameid));
                detail = await resp.json();
                state.detailCache[gameid] = detail;
            } catch {
                detailTr.querySelector('.game-detail').innerHTML = '<div class="empty-state">Failed to load</div>';
                return;
            }
        }

        detailTr.querySelector('td').innerHTML = renderDetail(detail, row.dataset.aSide);
    }

    function renderDetail(d, aSide) {
        // aSide tells us which side Team A was on — determines display order
        const blueFirst = true; // Always show blue on left, red on right

        function fmtGold(n) {
            return n ? n.toLocaleString() : '0';
        }

        function fmtDmg(n) {
            return n ? n.toLocaleString() : '0';
        }

        function renderSide(side, sideLabel, colorClass) {
            const ts = side.team_stats;
            const players = side.players;

            const bansHtml = ts.bans && ts.bans.some(b => b)
                ? `<div class="detail-bans">
                       <span class="ban-label">Bans:</span>
                       ${ts.bans.filter(b => b).map(b => `<span class="ban-champ">${b}</span>`).join(', ')}
                   </div>`
                : '';

            return `
                <div class="detail-side ${sideLabel === 'Blue' ? 'blue-side' : ''}">
                    <div class="detail-side-header">
                        <span class="detail-team-name ${colorClass}">${ts.team}</span>
                        <span class="detail-result-badge ${ts.result ? 'win' : 'loss'}">${ts.result ? 'WIN' : 'LOSS'}</span>
                    </div>
                    <table class="detail-players">
                        <thead>
                            <tr>
                                <th class="al">Champion</th>
                                <th>Pos</th>
                                <th>Player</th>
                                <th>K</th>
                                <th>D</th>
                                <th>A</th>
                                <th>CS</th>
                                <th>Gold</th>
                                <th>Dmg</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${players.map(p => `
                                <tr>
                                    <td class="champ">${p.champion}</td>
                                    <td><span class="pos">${p.position}</span></td>
                                    <td>${p.player}</td>
                                    <td>${p.kills}</td>
                                    <td>${p.deaths}</td>
                                    <td>${p.assists}</td>
                                    <td>${fmtGold(p.cs)}</td>
                                    <td>${fmtGold(p.gold)}</td>
                                    <td>${fmtDmg(p.damage)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div class="detail-objectives">
                        <span class="obj-item"><span class="obj-label">Towers</span> <span class="obj-val">${ts.towers}</span></span>
                        <span class="obj-item"><span class="obj-label">Dragons</span> <span class="obj-val">${ts.dragons}</span></span>
                        <span class="obj-item"><span class="obj-label">Barons</span> <span class="obj-val">${ts.barons}</span></span>
                        <span class="obj-item"><span class="obj-label">Grubs</span> <span class="obj-val">${ts.grubs}</span></span>
                        <span class="obj-item"><span class="obj-label">Atakhan</span> <span class="obj-val">${ts.atakhans}</span></span>
                        <span class="obj-item"><span class="obj-label">FB</span> <span class="${ts.firstblood ? 'obj-yes' : 'obj-no'}">${ts.firstblood ? '✓' : '—'}</span></span>
                        <span class="obj-item"><span class="obj-label">1st Drake</span> <span class="${ts.firstdragon ? 'obj-yes' : 'obj-no'}">${ts.firstdragon ? '✓' : '—'}</span></span>
                        <span class="obj-item"><span class="obj-label">1st Tower</span> <span class="${ts.firsttower ? 'obj-yes' : 'obj-no'}">${ts.firsttower ? '✓' : '—'}</span></span>
                        <span class="obj-item"><span class="obj-label">1st Herald</span> <span class="${ts.firstherald ? 'obj-yes' : 'obj-no'}">${ts.firstherald ? '✓' : '—'}</span></span>
                    </div>
                    ${bansHtml}
                </div>
            `;
        }

        return `
            <div class="game-detail">
                <div class="detail-grid">
                    ${renderSide(d.blue, 'Blue', 'blue')}
                    ${renderSide(d.red, 'Red', 'red')}
                </div>
                <div class="detail-footer">
                    <span><span class="detail-stat-label">Total Kills</span> <span class="detail-stat-val">${d.total_kills}</span></span>
                    <span><span class="detail-stat-label">Game Length</span> <span class="detail-stat-val">${d.gamelength}</span></span>
                </div>
            </div>
        `;
    }

    // ── Clear ──
    function onClear() {
        document.querySelectorAll('.champ-input').forEach(inp => inp.value = '');
        // Reset league checkboxes to default state
        document.querySelectorAll('#league-checkboxes .league-group').forEach(group => {
            const groupName = group.dataset.group;
            const cfg = LEAGUE_GROUPS.find(g => g.label === groupName);
            const def = cfg ? cfg.defaultChecked : true;
            group.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = def);
        });
        // Reset year checkboxes to default (both on)
        document.querySelectorAll('.year-cb').forEach(cb => cb.checked = true);
        document.getElementById('summary').classList.add('hidden');
        document.getElementById('results-panel').classList.add('hidden');
        document.getElementById('results-body').innerHTML = '';
        document.getElementById('btn-discord').disabled = true;
        state.results = null;
        state.expandedGame = null;
        state.detailCache = {};
        // Focus first input
        document.querySelector('#team-a-champs .champ-input').focus();
    }

    // ── Discord send ──
    async function onSendDiscord() {
        const r = state.results;
        if (!r || !r.total) {
            toast('Run a search first', 'error');
            return;
        }

        const teamA = [];
        document.querySelectorAll('#team-a-champs .champ-input').forEach(inp => {
            if (inp.value.trim()) teamA.push(inp.value.trim());
        });
        const teamB = [];
        document.querySelectorAll('#team-b-champs .champ-input').forEach(inp => {
            if (inp.value.trim()) teamB.push(inp.value.trim());
        });

        const aWr = r.team_a_wr;
        const bWr = Math.round((100 - aWr) * 10) / 10;
        const aAdj = r.normalized_wr;
        const bAdj = aAdj !== null && aAdj !== undefined
            ? Math.round((100 - aAdj) * 10) / 10
            : null;

        const btn = document.getElementById('btn-discord');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span> Sending...';

        try {
            const resp = await fetch('/api/discord', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    team_a: teamA,
                    team_b: teamB,
                    total: r.total,
                    team_a_wr: aWr,
                    team_b_wr: bWr,
                    team_a_adj: aAdj,
                    team_b_adj: bAdj,
                }),
            });
            const data = await resp.json();
            if (!resp.ok) {
                toast(data.error || 'Failed to send', 'error');
                return;
            }
            toast('Sent to Discord');
        } catch {
            toast('Network error', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  Scaling tab
    // ══════════════════════════════════════════════════════════

    const scalingState = {
        data: null,
        sortKey: 'delta',
        sortDir: 'desc',
        roleFilter: '',  // '' = all roles
        initialized: false,
    };

    const ROLE_LABEL = { top: 'Top', jng: 'Jng', mid: 'Mid', bot: 'Bot', sup: 'Sup' };
    // Roughly the existing palette — distinct hues per role, picked to read on dark bg.
    const ROLE_COLOR = {
        top: '#fbbf24',  // amber
        jng: '#34d399',  // emerald
        mid: '#22d3ee',  // cyan
        bot: '#fb7185',  // red-side rose
        sup: '#a78bfa',  // violet
    };

    // Parallel league filter — separate from the matchup one so the user can
    // look at scaling under a different league set than they're searching with.
    function setupScalingLeagueFilter() {
        const container = document.getElementById('scaling-league-checkboxes');
        const available = new Set(state.ac ? state.ac.leagues : []);
        const placed = new Set();

        let html = '';
        for (const group of LEAGUE_GROUPS) {
            const groupLeagues = group.leagues.filter(l => available.has(l));
            if (!groupLeagues.length) continue;
            groupLeagues.forEach(l => placed.add(l));
            const chk = group.defaultChecked ? 'checked' : '';
            html += `<div class="league-group" data-group="${group.label}">
                <label class="league-group-header">
                    <input type="checkbox" class="group-toggle" ${chk}>
                    <span>${group.label}</span>
                </label>
                <div class="league-group-items">
                    ${groupLeagues.map(l =>
                        `<label class="league-cb"><input type="checkbox" value="${l}" ${chk}><span>${l}</span></label>`
                    ).join('')}
                </div>
            </div>`;
        }
        const leftover = [...available].filter(l => !placed.has(l)).sort();
        if (leftover.length) {
            html += `<div class="league-group" data-group="Other">
                <label class="league-group-header">
                    <input type="checkbox" class="group-toggle" checked>
                    <span>Other</span>
                </label>
                <div class="league-group-items">
                    ${leftover.map(l =>
                        `<label class="league-cb"><input type="checkbox" value="${l}" checked><span>${l}</span></label>`
                    ).join('')}
                </div>
            </div>`;
        }
        container.innerHTML = html;

        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('group-toggle')) {
                const group = e.target.closest('.league-group');
                group.querySelectorAll('.league-group-items input[type="checkbox"]').forEach(
                    cb => cb.checked = e.target.checked
                );
            } else {
                const group = e.target.closest('.league-group');
                if (group) {
                    const boxes = group.querySelectorAll('.league-group-items input[type="checkbox"]');
                    const allChecked = [...boxes].every(cb => cb.checked);
                    group.querySelector('.group-toggle').checked = allChecked;
                }
            }
        });
    }

    function getScalingLeagues() {
        return [...document.querySelectorAll('#scaling-league-checkboxes .league-group-items input[type="checkbox"]:checked')]
            .map(cb => cb.value);
    }

    function getScalingYears() {
        return [...document.querySelectorAll('.scaling-year-cb:checked')].map(cb => cb.value);
    }

    async function fetchScaling() {
        const leagues = getScalingLeagues();
        if (!leagues.length) {
            toast('Select at least one league', 'error');
            return;
        }
        const btn = document.getElementById('scaling-refresh');
        const old = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span> Loading...';
        try {
            const resp = await fetch('/api/champion-scaling', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leagues, years: getScalingYears() }),
            });
            const data = await resp.json();
            if (!resp.ok) {
                toast(data.error || 'Failed', 'error');
                return;
            }
            scalingState.data = data;
            renderScaling();
        } catch {
            toast('Network error', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    }

    function renderScaling() {
        const data = scalingState.data;
        if (!data) return;

        document.getElementById('scaling-meta').textContent =
            `${data.n_games_total.toLocaleString()} player-rows  ·  p25=${data.p25_min}min  ·  p75=${data.p75_min}min`;
        document.getElementById('th-wr-p25').textContent = `WR @ ${data.p25_min}m`;
        document.getElementById('th-wr-p75').textContent = `WR @ ${data.p75_min}m`;

        const search = document.getElementById('scaling-search').value.trim().toLowerCase();
        const minN = document.getElementById('scaling-min-n').checked;

        let rows = data.champions;
        if (search) rows = rows.filter(c => c.champion.toLowerCase().includes(search));
        if (minN) rows = rows.filter(c => c.n >= 100);
        if (scalingState.roleFilter) {
            rows = rows.filter(c => c.role === scalingState.roleFilter);
        }

        const key = scalingState.sortKey;
        const dir = scalingState.sortDir === 'asc' ? 1 : -1;
        rows = [...rows].sort((a, b) => {
            const av = a[key], bv = b[key];
            if (av === null && bv === null) return 0;
            if (av === null) return 1;   // nulls always last
            if (bv === null) return -1;
            if (typeof av === 'string') return av.localeCompare(bv) * dir;
            return (av - bv) * dir;
        });

        const tbody = document.getElementById('scaling-body');
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state" style="padding: 24px; color: var(--text-muted);">No champions match</td></tr>';
        } else {
            tbody.innerHTML = rows.map(c => {
                const dCls = c.delta === null ? 'dim' : c.delta > 0 ? 'delta-pos' : c.delta < 0 ? 'delta-neg' : '';
                const sCls = c.slope === null ? 'dim' : c.slope > 0 ? 'delta-pos' : c.slope < 0 ? 'delta-neg' : '';
                const fmtSigned = (v, d) => v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d);
                const fmtPct = v => v === null ? '—' : v.toFixed(1) + '%';
                const roleLabel = c.role ? (ROLE_LABEL[c.role] || c.role) : '—';
                return `<tr>
                    <td class="al">${c.champion}</td>
                    <td><span class="role-tag">${roleLabel}</span></td>
                    <td>${c.n}</td>
                    <td>${c.wr.toFixed(1)}%</td>
                    <td>${fmtPct(c.wr_p25)}</td>
                    <td>${fmtPct(c.wr_p75)}</td>
                    <td class="${dCls}">${fmtSigned(c.delta, 1)}</td>
                    <td class="${sCls}">${fmtSigned(c.slope, 2)}</td>
                    <td>${c.pvalue === null ? '—' : c.pvalue.toFixed(3)}</td>
                </tr>`;
            }).join('');
        }

        document.querySelectorAll('.scaling-table thead th').forEach(th => {
            th.classList.remove('sort-active', 'asc');
            if (th.dataset.sort === key) {
                th.classList.add('sort-active');
                if (scalingState.sortDir === 'asc') th.classList.add('asc');
            }
        });

        renderScalingChart(rows);
    }

    // Read the matchup picker. Returns [] when nothing is picked.
    // Each entry: { champ: <data row>, side: 'blue'|'red' }. Picks bypass the
    // role/search/min-N filters — explicit picks always show.
    function getMatchupPicks() {
        if (!scalingState.data) return [];
        const byName = new Map(scalingState.data.champions.map(c => [c.champion.toLowerCase(), c]));
        const picks = [];
        document.querySelectorAll('.scaling-pick-input').forEach(inp => {
            const v = inp.value.trim();
            if (!v) return;
            const c = byName.get(v.toLowerCase());
            if (c && c.slope !== null && c.wr !== null) {
                picks.push({ champ: c, side: inp.dataset.side });
            }
        });
        return picks;
    }

    // ── Scatter: slope (x) vs WR (y), colored by role (or by team in matchup
    // mode), sized by N. Renders the same post-filter rows as the table so
    // role/search/min-N drive both views in lockstep — UNLESS the matchup
    // picker has any champs entered, in which case it plots only those.
    function renderScalingChart(rows) {
        const svg = document.getElementById('scaling-chart');
        const tooltip = document.getElementById('scaling-tooltip');
        const meta = document.getElementById('scaling-chart-count');

        const picks = getMatchupPicks();
        const matchupMode = picks.length > 0;

        // In matchup mode, the data points are the picks (with a side); otherwise
        // every filtered champ. Keep a uniform shape: { c, side }.
        const plottable = matchupMode
            ? picks
            : rows.filter(r => r.slope !== null && r.wr !== null).map(c => ({ champ: c, side: null }));
        meta.textContent = matchupMode
            ? `Matchup mode — ${picks.length} champ${picks.length === 1 ? '' : 's'} picked`
            : `${plottable.length} champ${plottable.length === 1 ? '' : 's'} plotted`;

        const W = 880, H = 480;
        const M = { top: 24, right: 28, bottom: 56, left: 64 };
        const innerW = W - M.left - M.right;
        const innerH = H - M.top - M.bottom;

        if (!plottable.length) {
            svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" class="axis-label">No data to plot</text>`;
            return;
        }

        // Symmetric x-domain around 0 so neutral=center; padded slightly.
        const slopes = plottable.map(p => p.champ.slope);
        const wrs = plottable.map(p => p.champ.wr);
        const sMax = Math.max(0.5, ...slopes.map(Math.abs)) * 1.1;
        const xMin = -sMax, xMax = sMax;
        // Y-domain: WR range with padding, but always include 50%.
        const wrLo = Math.min(45, ...wrs) - 2;
        const wrHi = Math.max(55, ...wrs) + 2;

        const x = v => M.left + ((v - xMin) / (xMax - xMin)) * innerW;
        const y = v => M.top + (1 - (v - wrLo) / (wrHi - wrLo)) * innerH;
        const r = n => Math.max(3.5, Math.min(14, Math.sqrt(n) * 0.45));

        // Build x-tick values (rounded). Pick step that gives ~6 ticks.
        function niceTicks(lo, hi, target) {
            const span = hi - lo;
            const raw = span / target;
            const mag = Math.pow(10, Math.floor(Math.log10(raw)));
            const norm = raw / mag;
            const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
            const ticks = [];
            const start = Math.ceil(lo / step) * step;
            for (let v = start; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
            return ticks;
        }
        const xTicks = niceTicks(xMin, xMax, 7);
        const yTicks = niceTicks(wrLo, wrHi, 6);

        // Build SVG content
        const parts = [];

        // Gridlines
        for (const xv of xTicks) {
            parts.push(`<line class="grid-line" x1="${x(xv)}" y1="${M.top}" x2="${x(xv)}" y2="${M.top + innerH}"/>`);
        }
        for (const yv of yTicks) {
            parts.push(`<line class="grid-line" x1="${M.left}" y1="${y(yv)}" x2="${M.left + innerW}" y2="${y(yv)}"/>`);
        }

        // Quadrant-defining neutral lines: slope=0 and WR=50
        if (xMin <= 0 && xMax >= 0) {
            parts.push(`<line class="neutral-line" x1="${x(0)}" y1="${M.top}" x2="${x(0)}" y2="${M.top + innerH}"/>`);
        }
        if (wrLo <= 50 && wrHi >= 50) {
            parts.push(`<line class="neutral-line" x1="${M.left}" y1="${y(50)}" x2="${M.left + innerW}" y2="${y(50)}"/>`);
        }

        // Axis frame
        parts.push(`<line class="axis-line" x1="${M.left}" y1="${M.top + innerH}" x2="${M.left + innerW}" y2="${M.top + innerH}"/>`);
        parts.push(`<line class="axis-line" x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + innerH}"/>`);

        // Tick labels
        for (const xv of xTicks) {
            const sign = xv > 0 ? '+' : '';
            parts.push(`<text class="tick-label" x="${x(xv)}" y="${M.top + innerH + 14}" text-anchor="middle">${sign}${xv}</text>`);
        }
        for (const yv of yTicks) {
            parts.push(`<text class="tick-label" x="${M.left - 8}" y="${y(yv) + 3}" text-anchor="end">${yv}%</text>`);
        }

        // Axis titles
        parts.push(`<text class="axis-label" x="${M.left + innerW/2}" y="${H - 14}" text-anchor="middle">Slope (WR % per minute) — left = falls off, right = scales</text>`);
        parts.push(`<text class="axis-label" x="${-(M.top + innerH/2)}" y="18" transform="rotate(-90)" text-anchor="middle">Overall Win Rate</text>`);

        // Quadrant labels (only if we straddle both neutral lines)
        if (xMin < 0 && xMax > 0 && wrLo < 50 && wrHi > 50) {
            parts.push(`<text class="quad-label" x="${M.left + innerW - 6}" y="${M.top + 14}" text-anchor="end">GOOD &amp; SCALES ↗</text>`);
            parts.push(`<text class="quad-label" x="${M.left + 6}" y="${M.top + 14}">↖ GOOD EARLY</text>`);
            parts.push(`<text class="quad-label" x="${M.left + innerW - 6}" y="${M.top + innerH - 6}" text-anchor="end">SCALES BUT WEAK ↘</text>`);
            parts.push(`<text class="quad-label" x="${M.left + 6}" y="${M.top + innerH - 6}">↙ STRUGGLING</text>`);
        }

        // Sort dots by N ascending so big dots paint on top of small ones.
        // In matchup mode keep insertion order (which already follows team grouping).
        const sorted = matchupMode
            ? plottable
            : [...plottable].sort((a, b) => a.champ.n - b.champ.n);
        for (const p of sorted) {
            const c = p.champ;
            const cx = x(c.slope), cy = y(c.wr), rad = r(c.n);
            // In matchup mode, color by team; otherwise by role.
            const fill = matchupMode
                ? (p.side === 'blue' ? '#60a5fa' : '#fb7185')
                : (ROLE_COLOR[c.role] || '#888');
            const teamCls = matchupMode ? ` team-${p.side}` : '';
            // Slightly bigger dots in matchup mode (only 10 of them, can afford it)
            const r2 = matchupMode ? Math.max(rad, 7) : rad;
            parts.push(
                `<circle class="dot${teamCls}" data-champ="${c.champion.replace(/"/g, '&quot;')}" ` +
                `cx="${cx}" cy="${cy}" r="${r2}" fill="${fill}" fill-opacity="0.85"/>`
            );
        }

        // Labels: in matchup mode, label every champ (only 10, plenty of room).
        // Otherwise label the most extreme champs by |delta| so the chart still
        // reads at a glance without manually searching for names.
        const labelTargets = matchupMode
            ? plottable
            : (() => {
                const sortedByDelta = [...plottable].sort((a, b) => b.champ.delta - a.champ.delta);
                return [...sortedByDelta.slice(0, 3), ...sortedByDelta.slice(-3)];
            })();
        const labeled = new Set();
        for (const p of labelTargets) {
            const c = p.champ;
            const key = c.champion + '|' + (p.side || '');
            if (labeled.has(key)) continue;
            labeled.add(key);
            const cx = x(c.slope), cy = y(c.wr), rad = r(c.n);
            const r2 = matchupMode ? Math.max(rad, 7) : rad;
            const tx = c.slope >= 0 ? cx + r2 + 4 : cx - r2 - 4;
            const anchor = c.slope >= 0 ? 'start' : 'end';
            const cls = matchupMode
                ? `matchup-label`
                : 'champ-label';
            const color = matchupMode
                ? (p.side === 'blue' ? '#60a5fa' : '#fb7185')
                : '';
            const fillAttr = color ? ` fill="${color}"` : '';
            parts.push(`<text class="${cls}" x="${tx}" y="${cy + 3}" text-anchor="${anchor}"${fillAttr}>${c.champion}</text>`);
        }

        svg.innerHTML = parts.join('');

        // Tooltip + hover handling
        svg.addEventListener('mouseleave', hideTooltip);
        svg.querySelectorAll('.dot').forEach(dot => {
            dot.addEventListener('mouseenter', (e) => {
                svg.classList.add('has-hover');
                svg.querySelectorAll('.dot.hover').forEach(d => d.classList.remove('hover'));
                dot.classList.add('hover');
                showTooltip(dot, e);
            });
            dot.addEventListener('mousemove', (e) => positionTooltip(e));
            dot.addEventListener('mouseleave', () => {
                dot.classList.remove('hover');
                svg.classList.remove('has-hover');
                hideTooltip();
            });
        });

        function showTooltip(dot, e) {
            const name = dot.getAttribute('data-champ');
            const p = plottable.find(p => p.champ.champion === name);
            if (!p) return;
            const c = p.champ;
            const sign = v => (v > 0 ? '+' : '') + v;
            const roleHtml = `<span class="tt-role">${ROLE_LABEL[c.role] || c.role || '—'}</span>`;
            tooltip.innerHTML = `
                <div class="tt-name">${c.champion} ${roleHtml}</div>
                <div class="tt-row"><span>Games</span><b>${c.n}</b></div>
                <div class="tt-row"><span>Win rate</span><b>${c.wr.toFixed(1)}%</b></div>
                <div class="tt-row"><span>Δ (p25 → p75)</span><b>${sign(c.delta.toFixed(1))}</b></div>
                <div class="tt-row"><span>Slope</span><b>${sign(c.slope.toFixed(2))} %/min</b></div>
                <div class="tt-row"><span>p-value</span><b>${c.pvalue.toFixed(3)}</b></div>
            `;
            tooltip.classList.add('show');
            positionTooltip(e);
        }

        function positionTooltip(e) {
            const wrap = tooltip.parentElement.getBoundingClientRect();
            const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
            let left = e.clientX - wrap.left + 14;
            let top = e.clientY - wrap.top + 14;
            // Keep tooltip inside the wrap
            if (left + tw > wrap.width - 8) left = e.clientX - wrap.left - tw - 14;
            if (top + th > wrap.height - 8) top = e.clientY - wrap.top - th - 14;
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        }

        function hideTooltip() {
            tooltip.classList.remove('show');
        }

        // Render legend — team colors in matchup mode, roles otherwise.
        const legend = document.getElementById('scaling-chart-legend');
        if (matchupMode) {
            legend.innerHTML = `
                <span class="scaling-legend-item">
                    <span class="scaling-legend-swatch" style="background:#60a5fa"></span>
                    Blue Team
                </span>
                <span class="scaling-legend-item">
                    <span class="scaling-legend-swatch" style="background:#fb7185"></span>
                    Red Team
                </span>`;
        } else {
            legend.innerHTML = ['top','jng','mid','bot','sup'].map(r =>
                `<span class="scaling-legend-item">
                    <span class="scaling-legend-swatch" style="background:${ROLE_COLOR[r]}"></span>
                    ${ROLE_LABEL[r]}
                </span>`
            ).join('') + `<span class="scaling-legend-item" style="margin-left:18px; color:var(--text-muted)">dot size = sample N</span>`;
        }
    }

    function setupScalingTab() {
        setupScalingLeagueFilter();
        document.getElementById('scaling-refresh').addEventListener('click', fetchScaling);
        document.getElementById('scaling-search').addEventListener('input', renderScaling);
        document.getElementById('scaling-min-n').addEventListener('change', renderScaling);

        // Matchup picker: autocomplete on each of the 10 inputs, re-render
        // chart on every keystroke / selection. Picks bypass table filters.
        document.querySelectorAll('.scaling-pick-input').forEach(input => {
            setupAutocomplete(input, () => state.ac ? state.ac.champions : [], () => {
                renderScaling();
                // Auto-focus next empty input on the same side
                const side = input.dataset.side;
                const peers = document.querySelectorAll(`.scaling-pick-input[data-side="${side}"]`);
                for (const p of peers) {
                    if (!p.value.trim() && p !== input) { p.focus(); return; }
                }
            });
            input.addEventListener('input', () => {
                if (!input.value.trim()) renderScaling();
            });
        });
        document.getElementById('scaling-pick-clear').addEventListener('click', () => {
            document.querySelectorAll('.scaling-pick-input').forEach(i => i.value = '');
            renderScaling();
        });

        document.getElementById('scaling-role-filter').addEventListener('click', (e) => {
            const btn = e.target.closest('.role-btn');
            if (!btn) return;
            scalingState.roleFilter = btn.dataset.role;
            document.querySelectorAll('#scaling-role-filter .role-btn').forEach(
                b => b.classList.toggle('active', b === btn)
            );
            renderScaling();
        });

        document.querySelectorAll('.scaling-table thead th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (scalingState.sortKey === key) {
                    scalingState.sortDir = scalingState.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    scalingState.sortKey = key;
                    // String columns default ascending; numeric default descending.
                    scalingState.sortDir = (key === 'champion') ? 'asc' : 'desc';
                }
                renderScaling();
            });
        });
    }

    function setupTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
                document.querySelector('.view-matchup').classList.toggle('hidden', tab !== 'matchup');
                document.querySelector('.view-scaling').classList.toggle('hidden', tab !== 'scaling');
                if (tab === 'scaling' && !scalingState.initialized) {
                    scalingState.initialized = true;
                    fetchScaling();
                }
            });
        });
    }

    // ── Init ──
    async function init() {
        // Load autocomplete data
        try {
            const resp = await fetch('/api/autocomplete');
            state.ac = await resp.json();
        } catch {
            toast('Failed to load champion data', 'error');
            return;
        }

        // Setup champion autocomplete on all inputs
        document.querySelectorAll('.champ-input').forEach(input => {
            setupAutocomplete(input, () => state.ac ? state.ac.champions : [], (val, inp) => {
                // Auto-focus next empty input in same column
                const col = inp.closest('.champ-list');
                const inputs = col.querySelectorAll('.champ-input');
                for (const next of inputs) {
                    if (!next.value.trim() && next !== inp) {
                        next.focus();
                        return;
                    }
                }
            });
        });

        // Setup league filter
        setupLeagueFilter();

        // Setup tab nav and Scaling tab (lazy-fetches on first activation)
        setupTabs();
        setupScalingTab();

        // Buttons
        document.getElementById('btn-search').addEventListener('click', onSearch);
        document.getElementById('btn-clear').addEventListener('click', onClear);
        document.getElementById('btn-discord').addEventListener('click', onSendDiscord);

        // Enter to search (when not in autocomplete)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.querySelector('.ac-dropdown.open')) {
                const active = document.activeElement;
                if (active && (active.classList.contains('champ-input') || active.id === 'league-input')) {
                    onSearch();
                }
            }
        });

        // Row click for detail
        document.getElementById('results-body').addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-gameid]');
            if (row) toggleDetail(row.dataset.gameid, row);
        });

        // Focus first input
        document.querySelector('#team-a-champs .champ-input').focus();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
