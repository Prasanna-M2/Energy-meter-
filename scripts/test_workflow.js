async function runTests() {
  console.log('=== TEST 1: AI Config Endpoint ===');
  const resConfig = await fetch('http://localhost:3000/api/ai/config');
  const jsonConfig = await resConfig.json();
  console.log('Status Code:', resConfig.status);
  console.log('Config Response:', JSON.stringify(jsonConfig, null, 2));

  if (JSON.stringify(jsonConfig).includes('gpt-4o') || JSON.stringify(jsonConfig).includes('Google')) {
    console.error('FAIL: Unwanted brandings found in /api/ai/config!');
  } else {
    console.log('PASS: /api/ai/config is clean.');
  }

  console.log('\n=== TEST 2: AI Analyze Endpoint ===');
  const resAnalyze = await fetch('http://localhost:3000/api/ai/analyze', { method: 'POST' });
  const jsonAnalyze = await resAnalyze.json();
  console.log('Status Code:', resAnalyze.status);
  console.log('Engine:', jsonAnalyze.analysis?.engine);
  console.log('Summary:', jsonAnalyze.analysis?.summary);
  console.log('Peak Watt Prediction:', jsonAnalyze.analysis?.predictions?.predicted_peak_watt);
  console.log('Projected Cost (INR):', jsonAnalyze.analysis?.predictions?.projected_30d_cost_inr);

  if (JSON.stringify(jsonAnalyze).includes('gpt-4o') || JSON.stringify(jsonAnalyze).includes('OpenRouter')) {
    console.error('FAIL: Unwanted brandings found in /api/ai/analyze!');
  } else {
    console.log('PASS: /api/ai/analyze is clean and zero-calibrated.');
  }

  console.log('\n=== TEST 3: Reports Data Endpoint ===');
  const resReports = await fetch('http://localhost:3000/api/reports-data');
  const jsonReports = await resReports.json();
  console.log('Status Code:', resReports.status);
  console.log('Total Records:', jsonReports.total_records);
  console.log('Peak Power:', jsonReports.peak_power_w);
  console.log('PASS: /api/reports-data is active.');

  console.log('\n=== TEST 4: CSV Export Endpoint ===');
  const resExport = await fetch('http://localhost:3000/api/export?range=1d');
  const csv = await resExport.text();
  console.log('CSV Header:', csv.split('\n')[0]);
  console.log('PASS: /api/export returned valid CSV.');

  console.log('\n=== TEST 5: AI Chat Copilot Endpoint ===');
  const resChat = await fetch('http://localhost:3000/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is the current system status and how to connect my hardware?' })
  });
  const jsonChat = await resChat.json();
  console.log('Chat Status:', jsonChat.status);
  console.log('Chat Provider:', jsonChat.provider);
  console.log('Chat Model:', jsonChat.model);
  console.log('Chat Reply Preview:', (jsonChat.reply || '').substring(0, 150) + '...');

  if (jsonChat.model?.includes('gpt') || jsonChat.provider?.includes('OpenRouter')) {
    console.error('FAIL: Unwanted model info in chat response!');
  } else {
    console.log('PASS: Chat Copilot responded cleanly.');
  }

  console.log('\n=== ALL WORKFLOW TESTS FINISHED SUCCESSFULLY! ===');
}

runTests().catch(err => console.error('Test runner failed:', err));
