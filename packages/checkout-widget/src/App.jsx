import React, { useState } from 'react';
import OrbitCheckout from './OrbitCheckout';

function App() {
  const [showWidget, setShowWidget] = useState(false);
  // This is the specific Plan ID we generated during our backend test earlier
  const [planId, setPlanId] = useState('a706f350-9baf-4245-89f3-e3d4519be19e'); 

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px' }}>
      
      {!showWidget ? (
        <div style={{ textAlign: 'center', backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <h1 style={{ margin: '0 0 20px 0' }}>SaaS Demo Page</h1>
          <p style={{ color: '#666', marginBottom: '20px' }}>This is a dummy website. Click below to pop the Orbit Widget.</p>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#333' }}>Plan ID (from Supabase):</label>
            <input 
              type="text" 
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              style={{ width: '300px', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>

          <button 
            onClick={() => setShowWidget(true)}
            style={{ padding: '12px 24px', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
          >
            Buy Subscription
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <OrbitCheckout planId={planId} />
          
          <button 
            onClick={() => setShowWidget(false)}
            style={{ marginTop: '30px', padding: '8px 16px', backgroundColor: 'transparent', color: '#666', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
          >
            Close Widget
          </button>
        </div>
      )}

    </div>
  );
}

export default App;
