from weasyprint import HTML

# Defining a comprehensive technical blueprint for a ManyChat Clone
html_content = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        @page {
            size: A4;
            margin: 15mm;
            background-color: #f0f4f8;
        }
        body {
            font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 10pt;
            color: #1a202c;
            line-height: 1.6;
            margin: 0;
            padding: 0;
        }
        .page-content {
            background-color: #ffffff;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .header {
            border-bottom: 4px solid #2563eb;
            margin-bottom: 30px;
            padding-bottom: 15px;
        }
        h1 { color: #1e40af; font-size: 22pt; margin: 0; text-transform: uppercase; letter-spacing: 1px; }
        h2 { color: #2563eb; font-size: 16pt; margin-top: 30px; border-left: 6px solid #2563eb; padding-left: 12px; }
        h3 { color: #374151; font-size: 12pt; margin-top: 20px; font-weight: 700; background: #f3f4f6; padding: 5px 10px; border-radius: 4px; }
        
        .code-block {
            background-color: #1e1e1e;
            color: #d4d4d4;
            padding: 15px;
            border-radius: 6px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 8.5pt;
            white-space: pre-wrap;
            margin: 15px 0;
            border: 1px solid #333;
        }
        
        .tech-tag {
            display: inline-block;
            background: #dbeafe;
            color: #1e40af;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 8pt;
            font-weight: bold;
            margin-right: 5px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            border: 1px solid #e2e8f0;
            padding: 10px;
            text-align: left;
        }
        th { background-color: #f8fafc; font-weight: bold; color: #475569; }
        
        .diagram-placeholder {
            border: 2px dashed #cbd5e1;
            padding: 20px;
            text-align: center;
            color: #64748b;
            margin: 20px 0;
            border-radius: 10px;
        }
    </style>
</head>
<body>
    <div class="page-content">
        <div class="header">
            <h1>Engineering Blueprint: ManyChat Clone (SaaS)</h1>
            <p>Architectural Design, Database Schema, and Execution Strategy</p>
        </div>

        <section>
            <h2>1. System Architecture (FAANG-Level Scale)</h2>
            <p>To handle millions of messages across Instagram, WhatsApp, and Messenger, the system must be <strong>Event-Driven</strong> and <strong>Asynchronous</strong>.</p>
            
            <div class="diagram-placeholder">
                [High-Level Flow: Webhook Ingress (Vercel) -> Message Queue (Upstash Redis) -> Worker Pool (Node.js/Go) -> Flow Engine -> Social API Outbound]
            </div>

            <ul>
                <li><strong>Ingress Layer:</strong> Serverless Edge Functions to acknowledge Meta webhooks within 2000ms.</li>
                <li><strong>State Management:</strong> Redis for transient session data (where the user is in a flow).</li>
                <li><strong>Flow Engine:</strong> A microservice that traverses the JSON-based Directed Acyclic Graph (DAG).</li>
            </ul>
        </section>

        <section>
            <h2>2. Database Schema (SQL Design)</h2>
            <p>Standardized PostgreSQL schema to manage organizations, subscribers, and automated flows.</p>
            <div class="code-block">
-- Organizations & Workspace
CREATE TABLE organizations (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_hash TEXT UNIQUE
);

-- Subscribers (The End Users)
CREATE TABLE subscribers (
    id UUID PRIMARY KEY,
    platform_id VARCHAR(100) UNIQUE, -- (PSID for FB, Phone for WA)
    org_id UUID REFERENCES organizations(id),
    first_name TEXT,
    tags JSONB DEFAULT '[]', -- Useful for segmentation
    created_at TIMESTAMP DEFAULT NOW()
);

-- Automation Flows
CREATE TABLE flows (
    id UUID PRIMARY KEY,
    org_id UUID REFERENCES organizations(id),
    name TEXT,
    trigger_type VARCHAR(50), -- (KEYWORD, COMMENT, STORY_REPLY)
    graph_json JSONB NOT NULL, -- The visual nodes logic
    is_published BOOLEAN DEFAULT FALSE
);
            </div>
        </section>

        <section>
            <h2>3. Implementation: Webhook to Worker</h2>
            <h3>Step A: The Receiver (Next.js/Vercel)</h3>
            <div class="code-block">
export async function POST(req: Request) {
    const payload = await req.json();
    const signature = req.headers.get('x-hub-signature-256');
    
    if (!verifyMetaSignature(payload, signature)) return new Response('Unauthorized', { status: 401 });

    // Push to Upstash Redis Queue for background processing
    await redis.lpush('msg_queue', JSON.stringify(payload));
    
    return new Response('EVENT_RECEIVED', { status: 200 });
}
            </div>

            <h3>Step B: The Worker Logic (Node.js)</h3>
            <div class="code-block">
async function processQueue() {
    const raw = await redis.brpop('msg_queue', 0);
    const data = JSON.parse(raw[1]);
    
    const senderId = data.entry[0].messaging[0].sender.id;
    const text = data.entry[0].messaging[0].message.text;

    // Fetch user state and current Flow
    const userState = await db.getState(senderId);
    const nextNode = flowEngine.getNextNode(userState, text);

    // Send response via Meta Graph API
    await metaClient.sendMessage(senderId, nextNode.content);
}
            </div>
        </section>

        <section>
            <h2>4. Technology Stack for Rapid Development</h2>
            <table>
                <tr>
                    <th>Layer</th>
                    <th>Technology Recommendation</th>
                </tr>
                <tr>
                    <td>Frontend</td>
                    <td>Next.js, TailwindCSS, <strong>React Flow</strong> (for the Builder)</td>
                </tr>
                <tr>
                    <td>Backend/API</td>
                    <td>Node.js (TypeScript) or Go</td>
                </tr>
                <tr>
                    <td>Queue</td>
                    <td>Upstash Redis or RabbitMQ</td>
                </tr>
                <tr>
                    <td>Database</td>
                    <td>Supabase (PostgreSQL + Auth)</td>
                </tr>
                <tr>
                    <td>Infrastructure</td>
                    <td>Vercel (Frontend/Webhooks) + Railway (Workers)</td>
                </tr>
            </table>
        </section>

        <section>
            <h2>5. Step-by-Step Build Plan</h2>
            <ol>
                <li><strong>Week 1:</strong> Setup Meta Developer App & WhatsApp Business API credentials. Build the webhook receiver.</li>
                <li><strong>Week 2:</strong> Build the "Bot Engine" that can respond to specific keywords using a flat database table.</li>
                <li><strong>Week 3-4:</strong> Develop the Visual Builder using <strong>React Flow</strong>. Map nodes to JSON.</li>
                <li><strong>Week 5:</strong> Implement "User Tagging" and "Custom Fields" to allow complex logic (If Tag=VIP then...).</li>
                <li><strong>Week 6:</strong> Integration with Stripe for subscription-based billing.</li>
            </ol>
        </section>

        <footer style="margin-top: 40px; font-size: 8pt; text-align: center; color: #94a3b8;">
            Technical Blueprint - ManyChat Clone - Internal Use Only
        </footer>
    </div>
</body>
</html>
"""

# Generate the PDF file
file_name = "ManyChat_Clone_Technical_Blueprint.pdf"
HTML(string=html_content).write_pdf(file_name)

print(file_name)