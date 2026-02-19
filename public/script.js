document.addEventListener('DOMContentLoaded', () => {
    const addressInput = document.getElementById('address');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const connectBtn = document.getElementById('connect-btn');
    const statusDiv = document.getElementById('connection-status');
    const mainContent = document.getElementById('main-content');
    const hostsTableBody = document.querySelector('#hosts-table tbody');
    const payloadSelect = document.getElementById('payload-select');
    const runBtn = document.getElementById('run-command-btn');
    const selectedCountSpan = document.getElementById('selected-count');
    const outputLog = document.getElementById('output-log');

    // Initial check
    fetch('/api/check-fleetctl')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'ok') {
                log('Fleetctl found: ' + data.message);
            } else {
                log('Error: Fleetctl not found.');
                connectBtn.disabled = true;
                statusDiv.innerText = 'Error: fleetctl not found in fleet_ctl/';
                statusDiv.classList.add('error');
            }
        });

    // Login Handler
    connectBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const address = addressInput.value;
        const email = emailInput.value;
        const password = passwordInput.value;

        if (!address || !email || !password) {
            alert('Please fill in all fields.');
            return;
        }

        log('Configuring Fleet...');
        try {
            // Step 1: Configure
            const configRes = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, context: 'default' })
            });
            const configData = await configRes.json();
            if (configData.status !== 'ok') {
                throw new Error(configData.message + (configData.details ? '\n' + configData.details : ''));
            }
            log('Configuration successful.');

            // Step 2: Login
            log('Logging in...');
            const loginRes = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, context: 'default' })
            });
            const loginData = await loginRes.json();
            if (loginData.status !== 'ok') {
                throw new Error(loginData.message + (loginData.details ? '\n' + loginData.details : ''));
            }
            
            log('Login successful!');
            statusDiv.innerText = 'Connected';
            statusDiv.classList.add('success');
            mainContent.classList.remove('hidden');

            // Load Initial Data
            loadHosts();
            loadPayloads();

        } catch (err) {
            console.error(err);
            log('Error: ' + err.message);
            statusDiv.innerText = 'Connection Failed';
            statusDiv.classList.add('error');
        }
    });

    // Load Hosts
    async function loadHosts() {
        log('Loading hosts...');
        hostsTableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
        try {
            const res = await fetch('/api/hosts?context=default');
            const data = await res.json();
            
            if (data.status === 'ok') {
                hostsTableBody.innerHTML = '';
                if (data.hosts && data.hosts.length > 0) {
                    data.hosts.forEach(host => {
                        const hostIdentifier = host.uuid || host.hostname || '';
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td><input type="checkbox" class="host-checkbox" value="${hostIdentifier}" ${hostIdentifier ? '' : 'disabled'}></td>
                            <td>${host.hostname || '-'}</td>
                            <td>${host.uuid || '-'}</td>
                            <td>${host.platform || '-'}</td>
                            <td>${host.status || '-'}</td>
                        `;
                        hostsTableBody.appendChild(row);
                    });
                    
                    // Add listeners to checkboxes
                    document.querySelectorAll('.host-checkbox').forEach(cb => {
                        cb.addEventListener('change', updateSelection);
                    });
                } else {
                    hostsTableBody.innerHTML = '<tr><td colspan="5">No hosts found.</td></tr>';
                }
                log(`Loaded ${data.hosts ? data.hosts.length : 0} hosts.`);
            } else {
                throw new Error(data.message + (data.details ? '\n' + data.details : ''));
            }
        } catch (err) {
            log('Failed to load hosts: ' + err.message);
            hostsTableBody.innerHTML = '<tr><td colspan="5">Error loading hosts.</td></tr>';
        }
    }

    // Load Payloads
    async function loadPayloads() {
        try {
            const res = await fetch('/api/payloads');
            const data = await res.json();
            if (data.status === 'ok') {
                payloadSelect.innerHTML = '<option value="">-- Select a Payload --</option>';
                data.payloads.forEach(payload => {
                    const option = document.createElement('option');
                    option.value = payload;
                    option.textContent = payload;
                    payloadSelect.appendChild(option);
                });
            }
        } catch (err) {
            log('Failed to load payloads: ' + err.message);
        }
    }

    // Update Selection Count
    function updateSelection() {
        const selected = document.querySelectorAll('.host-checkbox:checked');
        selectedCountSpan.textContent = selected.length;
        runBtn.disabled = selected.length === 0 || !payloadSelect.value;
    }

    payloadSelect.addEventListener('change', updateSelection);

    // Run Command
    runBtn.addEventListener('click', async () => {
        const selectedHosts = Array.from(document.querySelectorAll('.host-checkbox:checked')).map(cb => cb.value);
        const payload = payloadSelect.value;

        if (selectedHosts.length === 0 || !payload) return;

        log(`Running command using ${payload} on ${selectedHosts.length} hosts...`);
        runBtn.disabled = true;
        runBtn.textContent = 'Running...';

        try {
            const res = await fetch('/api/run-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hosts: selectedHosts,
                    payload: payload,
                    context: 'default'
                })
            });

            const data = await res.json();
            if (data.status === 'ok') {
                log('Command executed successfully:\n' + data.output);
            } else {
                throw new Error(data.message + (data.details ? '\n' + data.details : ''));
            }
        } catch (err) {
            log('Command failed: ' + err.message);
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = 'Run Command';
        }
    });

    function log(msg) {
        const timestamp = new Date().toLocaleTimeString();
        outputLog.textContent += `[${timestamp}] ${msg}\n`;
        outputLog.scrollTop = outputLog.scrollHeight;
    }
});
