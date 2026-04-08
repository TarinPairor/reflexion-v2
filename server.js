const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
require('dotenv').config();

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'conversation_data.json');
const ASSESSMENTS_FILE = path.join(__dirname, 'assessments_data.json');
const RESULTS_FILE = path.join(__dirname, 'session_results.json');

// Ensure results file exists as an array
if (!fs.existsSync(RESULTS_FILE)) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify([], null, 2));
} else {
    // Migrate old single-object format to array
    try {
        const existing = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
        if (!Array.isArray(existing)) {
            fs.writeFileSync(RESULTS_FILE, JSON.stringify([existing], null, 2));
        }
    } catch (e) {
        fs.writeFileSync(RESULTS_FILE, JSON.stringify([], null, 2));
    }
}

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

// Ensure assessments file exists
if (!fs.existsSync(ASSESSMENTS_FILE)) {
    fs.writeFileSync(ASSESSMENTS_FILE, JSON.stringify([], null, 2));
}

const server = http.createServer((req, res) => {
    // Serve home page
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
    // Serve dashboard
    else if (req.url === '/dashboard' || req.url === '/dashboard.html') {
        fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
    // Serve conversation realtime page
    else if (req.url === '/conversation_realtime' || req.url === '/conversation_realtime.html') {
        fs.readFile(path.join(__dirname, 'conversation_realtime.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
    // Serve TICS assessment page
    else if (req.url === '/tics_assessment' || req.url === '/tics_assessment.html') {
        fs.readFile(path.join(__dirname, 'tics_assessment.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
    // Serve audio test page
    else if (req.url === '/audio_test' || req.url === '/audio_test.html') {
        fs.readFile(path.join(__dirname, 'audio_test.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
    // Serve API key endpoint (for security, you might want to remove this)
    else if (req.url === '/api-key' && req.method === 'GET') {
        const apiKey = process.env.OPENAI_API_KEY || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ apiKey: apiKey }));
    }
    // Serve AssemblyAI API key endpoint
    else if (req.url === '/assembly-api-key' && req.method === 'GET') {
        const apiKey = process.env.ASSEMBLY_API_KEY || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ apiKey: apiKey }));
    }
    // Serve image files from public/images directory
    else if (req.url.startsWith('/images/')) {
        const imageName = req.url.replace('/images/', '');
        const imagePath = path.join(__dirname, 'public', 'images', imageName);
        
        // Security: only allow image files
        const allowedExtensions = ['.jpeg', '.jpg', '.png', '.gif', '.svg', '.webp', '.ico'];
        const ext = path.extname(imageName).toLowerCase();
        
        if (!allowedExtensions.includes(ext)) {
            res.writeHead(403);
            res.end('Forbidden file type');
            return;
        }
        
        fs.readFile(imagePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Image not found');
                return;
            }
            const contentType = ext === '.svg' ? 'image/svg+xml' : 
                               ext === '.ico' ? 'image/x-icon' : 
                               `image/${ext.replace('.', '')}`;
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }
    // Generate ephemeral key for Realtime API
    else if (req.url === '/token' && req.method === 'GET') {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'OPENAI_API_KEY not set' }));
            return;
        }

        // Generate ephemeral key from OpenAI
        const https = require('https');
        const postData = JSON.stringify({
            model: 'gpt-4o-realtime-preview-2024-12-17'
        });

        const options = {
            hostname: 'api.openai.com',
            path: '/v1/realtime/sessions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req2 = https.request(options, (res2) => {
            let data = '';
            res2.on('data', (chunk) => {
                data += chunk;
            });
            res2.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(jsonData));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid response from OpenAI' }));
                }
            });
        });

        req2.on('error', (error) => {
            console.error('Error generating ephemeral key:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        });

        req2.write(postData);
        req2.end();
    }
    // API: Save conversation data
    else if (req.url === '/api/conversations' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const newRecord = JSON.parse(body);
                
                // Read existing data
                const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                
                // Add new record
                data.push(newRecord);
                
                // Save back to file
                fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Record saved' }));
            } catch (error) {
                console.error('Error saving conversation:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }
    // API: Get all conversation data
    else if (req.url === '/api/conversations' && req.method === 'GET') {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (error) {
            console.error('Error reading conversations:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    // API: Save assessment data
    else if (req.url === '/api/assessments' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const newRecord = JSON.parse(body);
                
                // Read existing data
                const data = JSON.parse(fs.readFileSync(ASSESSMENTS_FILE, 'utf8'));
                
                // Add new record
                data.push(newRecord);
                
                // Save back to file
                fs.writeFileSync(ASSESSMENTS_FILE, JSON.stringify(data, null, 2));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Assessment record saved' }));
            } catch (error) {
                console.error('Error saving assessment:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }
    // API: Get all assessment data
    else if (req.url === '/api/assessments' && req.method === 'GET') {
        try {
            const data = JSON.parse(fs.readFileSync(ASSESSMENTS_FILE, 'utf8'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (error) {
            console.error('Error reading assessments:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    // API: Delete conversation by index
    else if (req.url.startsWith('/api/conversations/') && req.method === 'DELETE') {
        const parsedUrl = url.parse(req.url, true);
        const index = parseInt(parsedUrl.pathname.split('/').pop());
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (index >= 0 && index < data.length) {
                data.splice(index, 1);
                fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Record deleted' }));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid index' }));
            }
        } catch (error) {
            console.error('Error deleting conversation:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    // API: Delete assessment by index
    else if (req.url.startsWith('/api/assessments/') && req.method === 'DELETE') {
        const parsedUrl = url.parse(req.url, true);
        const index = parseInt(parsedUrl.pathname.split('/').pop());
        try {
            const data = JSON.parse(fs.readFileSync(ASSESSMENTS_FILE, 'utf8'));
            if (index >= 0 && index < data.length) {
                data.splice(index, 1);
                fs.writeFileSync(ASSESSMENTS_FILE, JSON.stringify(data, null, 2));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Assessment deleted' }));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid index' }));
            }
        } catch (error) {
            console.error('Error deleting assessment:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    // API: Receive session results from Pi (called by pi_audio_bridge.py)
    else if (req.url === '/results' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const newResult = JSON.parse(body);
                const existing = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
                existing.push(newResult);
                fs.writeFileSync(RESULTS_FILE, JSON.stringify(existing, null, 2));
                console.log('📊 Session results received from Pi and saved');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error saving results:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }
    // API: Serve session results to the dashboard
    else if (req.url === '/results' && req.method === 'GET') {
        try {
            const data = fs.readFileSync(RESULTS_FILE, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }
    // Serve static files if needed
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📝 Make sure OPENAI_API_KEY is set in your .env file`);
    console.log(`\n   Or enter it directly in the page when it loads\n`);
});

// Export for potential use as module
module.exports = server;

