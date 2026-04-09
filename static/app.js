(function () {
    'use strict';

    const LEAGUE_GROUPS = [
        { label: 'Tier 1', leagues: ['LCK', 'LPL', 'LEC', 'LTA N', 'LCS', 'LTA'], defaultChecked: true },
        { label: 'Academy', leagues: ['LCKC', 'LPLOL', 'KeSPA'], defaultChecked: true },
        { label: 'Tier 2', leagues: ['PCS', 'VCS', 'LCP', 'LJL', 'LTA S', 'CBLOL', 'TCL'], defaultChecked: true },
        { label: 'Regional', leagues: ['LFL', 'PRM', 'NLC', 'LVP SL', 'EM', 'LAS', 'NACL'], defaultChecked: true },
        { label: 'Junk', leagues: ['LFL2', 'PRMP', 'AL', 'HLL', 'EBL', 'LIT', 'RL', 'ROL', 'LES', 'HM', 'HW', 'NEXO', 'CT', 'LRN', 'LRS', 'CD', 'FST', 'ASI', 'CCWS'], defaultChecked: false },
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
                if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-search').click(); }
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
