require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from ENV or defaults
const FLEET_CTL_PATH = process.env.FLEET_CTL_PATH || path.resolve('./fleet_ctl/fleetctl');
const PAYLOADS_DIR = process.env.PAYLOADS_DIR || path.resolve('./payloads');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- Helper Functions ---

const runFleetCommand = (args, res) => {
    const safeArgs = args.map((arg, index) => {
        // Simple heuristic to mask password if preceding arg is --password
        if (index > 0 && args[index-1] === '--password') return '******';
        return arg;
    });
    console.log(`Executing: ${FLEET_CTL_PATH} ${safeArgs.join(' ')}`); // Log command (omit sensitive info in production logs!)
    
    execFile(FLEET_CTL_PATH, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Command failed: ${error.message}`);
            // Don't expose full error stack to client, just the message or stderr
            return res.status(500).json({ 
                status: 'error', 
                message: 'Command execution failed', 
                details: stderr || error.message 
            });
        }
        try {
            // Try to parse JSON if requested, otherwise return raw string
            if (args.includes('--json')) {
                const jsonOutput = parsePossibleJson(stdout);
                res.json({ status: 'ok', data: jsonOutput });
            } else {
                res.json({ status: 'ok', output: stdout });
            }
        } catch (e) {
             // Fallback for non-JSON output
            res.json({ status: 'ok', output: stdout });
        }
    });
};

const parsePossibleJson = (rawOutput) => {
    const trimmed = String(rawOutput || '').trim();
    if (!trimmed) {
        throw new Error('Empty output from fleetctl');
    }

    try {
        return JSON.parse(trimmed);
    } catch (firstErr) {
        // Support newline-delimited JSON (NDJSON): one JSON document per line.
        const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length > 1) {
            const parsedLines = [];
            let ndjsonValid = true;
            for (const line of lines) {
                try {
                    parsedLines.push(JSON.parse(line));
                } catch (_) {
                    ndjsonValid = false;
                    break;
                }
            }
            if (ndjsonValid) {
                return parsedLines;
            }
        }

        // Some fleetctl responses can include extra text around JSON.
        const startArray = trimmed.indexOf('[');
        const startObject = trimmed.indexOf('{');
        const startCandidates = [startArray, startObject].filter((idx) => idx >= 0);
        const jsonStart = startCandidates.length > 0 ? Math.min(...startCandidates) : -1;
        const endArray = trimmed.lastIndexOf(']');
        const endObject = trimmed.lastIndexOf('}');
        const jsonEnd = Math.max(endArray, endObject);

        if (jsonStart >= 0 && jsonEnd > jsonStart) {
            const candidate = trimmed.slice(jsonStart, jsonEnd + 1);
            return JSON.parse(candidate);
        }
        throw new Error(`No valid JSON found in fleetctl output (${firstErr.message})`);
    }
};

const extractHostsFromOutput = (parsedOutput) => {
    const normalizeHost = (host) => {
        const spec = host && typeof host === 'object' ? (host.spec || {}) : {};
        const detail = host && typeof host === 'object' ? (host.detail || {}) : {};
        const mdm = spec.mdm || {};

        const uuid =
            host?.uuid ||
            spec.uuid ||
            spec.hardware_uuid ||
            detail.uuid ||
            detail.hardware_uuid ||
            '';
        const hostname =
            host?.hostname ||
            spec.hostname ||
            spec.computer_name ||
            spec.display_name ||
            detail.hostname ||
            '';
        const platform =
            host?.platform ||
            spec.platform ||
            spec.osquery_platform ||
            '';
        const status =
            host?.status ||
            spec.status ||
            mdm.enrollment_status ||
            '';

        return {
            ...host,
            uuid: String(uuid || ''),
            hostname: String(hostname || ''),
            platform: String(platform || ''),
            status: String(status || '')
        };
    };

    const normalizeMany = (items) => items.map(normalizeHost);

    if (Array.isArray(parsedOutput)) {
        return normalizeMany(parsedOutput);
    }

    if (parsedOutput && typeof parsedOutput === 'object') {
        if (Array.isArray(parsedOutput.hosts)) {
            return normalizeMany(parsedOutput.hosts);
        }
        if (Array.isArray(parsedOutput.data)) {
            return normalizeMany(parsedOutput.data);
        }
        // Single host object fallback.
        return normalizeMany([parsedOutput]);
    }

    return [];
};

// Validation Helpers
const isValidHostname = (str) => /^[a-zA-Z0-9.-]+$/.test(str);
const isValidEmail = (str) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
const isValidContext = (str) => /^[a-zA-Z0-9._-]+$/.test(str || 'default');
const isValidUUID = (str) => /^[0-9a-fA-F-]{36}$/.test(str);
const isValidFilename = (str) => /^[a-zA-Z0-9._-]+$/.test(str) && !str.includes('..'); // Prevent directory traversal
const isValidHostIdentifier = (str) => {
    if (typeof str !== 'string' || !str.trim()) return false;
    if (isValidUUID(str.trim())) return true;
    // Allow hostnames/serial-like IDs including spaces.
    return /^[a-zA-Z0-9._\- ]+$/.test(str.trim());
};

// --- Routes ---

// Check if fleetctl exists
app.get('/api/check-fleetctl', (req, res) => {
    // Basic existence check
    if (fs.existsSync(FLEET_CTL_PATH)) {
        res.json({ status: 'ok', message: 'fleetctl found' });
    } else {
        res.status(404).json({ status: 'error', message: 'fleetctl not found at configured path' });
    }
});

// Configure Fleet
app.post('/api/config', (req, res) => {
    const { address, context } = req.body;

    if (!address || !address.startsWith('http')) {
        return res.status(400).json({ status: 'error', message: 'Invalid address URL' });
    }
    // Context validation
    if (!isValidContext(context)) {
        return res.status(400).json({ status: 'error', message: 'Invalid context name' });
    }

    const args = ['config', 'set', '--address', address, '--context', context || 'default'];
    runFleetCommand(args, res);
});

// Login to Fleet
app.post('/api/login', (req, res) => {
    const { email, password, context } = req.body;

    // Use explicit validation for safety
    if (!isValidEmail(email)) {
        return res.status(400).json({ status: 'error', message: 'Invalid email format' });
    }
    if (!password) {
        return res.status(400).json({ status: 'error', message: 'Password required' });
    }
    
    // Note: passing password via command line arguments is still visible in `ps` output.
    // In a production environment, use environment variables or stdin.
    // However, for this local tool, we'll proceed with execFile but mask logging.
    
    // fleetctl login --email ... --password ...
    const args = ['login', '--email', email, '--password', password, '--context', context || 'default'];
    
    // We call execFile directly here to avoid the logging helper exposing the password if we didn't use the masking logic
    // But since we added masking to runFleetCommand, we can use it.
    runFleetCommand(args, res);
});

// Get Hosts
app.get('/api/hosts', (req, res) => {
    const context = req.query.context || 'default';
    
    // Validate context - IMPORTANT!
    if (!isValidContext(context)) {
        return res.status(400).json({ status: 'error', message: 'Invalid context name' });
    }

    const args = ['get', 'hosts', '--mdm', '--json', '--context', context];
    
    // Using runFleetCommand for consistency and logging
    // But we need custom response handling here to wrap the output
    console.log(`Executing: ${FLEET_CTL_PATH} ${args.join(' ')}`);

    execFile(FLEET_CTL_PATH, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Get hosts error: ${error.message}`);
            return res.status(500).json({ status: 'error', message: 'Failed to fetch hosts', details: stderr || error.message });
        }
        try {
            const parsedOutput = parsePossibleJson(stdout);
            const hosts = extractHostsFromOutput(parsedOutput);
            res.json({ status: 'ok', hosts });
        } catch (e) {
            console.error('JSON Parse Error:', e);
            res.status(500).json({
                status: 'error',
                message: 'Failed to parse hosts JSON',
                details: `${e.message}. Raw output (first 400 chars): ${String(stdout || '').slice(0, 400)}`
            });
        }
    });
});

// Get Payloads (XML files)
app.get('/api/payloads', (req, res) => {
    fs.readdir(PAYLOADS_DIR, (err, files) => {
        if (err) {
            console.error(`Read payloads error: ${err.message}`);
            return res.status(500).json({ status: 'error', message: 'Failed to read payloads directory' });
        }
        const xmlFiles = files.filter(file => file.endsWith('.xml'));
        res.json({ status: 'ok', payloads: xmlFiles });
    });
});

// Run MDM Command
app.post('/api/run-command', (req, res) => {
    const { hosts, payload, context } = req.body; // hosts is array of UUIDs/hostnames/serials

    if (!Array.isArray(hosts) || hosts.length === 0) {
        return res.status(400).json({ status: 'error', message: 'No hosts selected' });
    }
    
    // Validate context
    if (!isValidContext(context)) {
        return res.status(400).json({ status: 'error', message: 'Invalid context name' });
    }

    // Validate host identifiers (UUID, hostname, serial number)
    const invalidHosts = hosts.filter((hostId) => !isValidHostIdentifier(hostId));
    if (invalidHosts.length > 0) {
        return res.status(400).json({ status: 'error', message: `Invalid host identifiers detected: ${invalidHosts.join(', ')}` });
    }

    if (!payload || !isValidFilename(payload)) {
        return res.status(400).json({ status: 'error', message: 'Invalid payload filename' });
    }

    const payloadPath = path.join(PAYLOADS_DIR, payload);
    if (!fs.existsSync(payloadPath)) {
        return res.status(404).json({ status: 'error', message: 'Payload file not found' });
    }

    const hostList = hosts.join(',');
    const args = ['mdm', 'run-command', '--payload', payloadPath, '--hosts', hostList, '--context', context || 'default'];

    runFleetCommand(args, res);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Configured Fleetctl Path: ${FLEET_CTL_PATH}`);
    console.log(`Configured Payloads Dir: ${PAYLOADS_DIR}`);
});
