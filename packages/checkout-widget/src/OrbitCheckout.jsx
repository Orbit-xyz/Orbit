import React, { useState, useEffect } from 'react';
import { isConnected, requestAccess } from '@stellar/freighter-api';
import { motion, AnimatePresence } from 'framer-motion';

const OrbitCheckout = ({ planId, apiUrl = 'http://localhost:3001' }) => {
    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [userAddress, setUserAddress] = useState(null);
    const [isSubscribing, setIsSubscribing] = useState(false);
    const [success, setSuccess] = useState(false);

    // Import Inter font dynamically if not present
    useEffect(() => {
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
    }, []);

    useEffect(() => {
        if (!planId) {
            setError("No planId provided.");
            setLoading(false);
            return;
        }

        const fetchPlan = async () => {
            try {
                const response = await fetch(`${apiUrl}/plans/${planId}`);
                if (!response.ok) throw new Error("Failed to fetch plan");
                const data = await response.json();
                setPlan(data.plan);
            } catch (err) {
                console.error("Error fetching plan:", err);
                setError("Could not load plan details.");
            } finally {
                setLoading(false);
            }
        };

        fetchPlan();
    }, [planId, apiUrl]);

    const handleConnect = async () => {
        try {
            const connected = await isConnected();
            if (!connected) {
                setError("Freighter extension not found. Please install it.");
                return;
            }

            // In v6+, requestAccess is the cleanest way to pop the wallet and get the user's address
            const result = await requestAccess();
            
            // Depending on version, it may return a string directly or an object
            const address = typeof result === 'string' ? result : result.address;
            
            if (address) {
                setUserAddress(address);
                setError(null);
            } else {
                setError("No address returned from wallet.");
            }
        } catch (err) {
            console.error("Freighter error:", err);
            setError(`Connection error: ${err.message || err.toString()}`);
        }
    };

    const handleSubscribe = async () => {
        setIsSubscribing(true);
        setError(null);
        try {
            await new Promise(resolve => setTimeout(resolve, 1500)); 
            const subResponse = await fetch(`${apiUrl}/subscriptions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_id: planId,
                    customer_wallet_address: userAddress
                })
            });

            if (!subResponse.ok) throw new Error("Failed to register subscription");
            setSuccess(true);
        } catch (err) {
            console.error("Subscription error:", err);
            setError("Failed to complete subscription. Try again.");
        } finally {
            setIsSubscribing(false);
        }
    };

    if (loading) return <div style={styles.container}>Loading Orbit checkout...</div>;
    if (error) return <div style={{ ...styles.container, color: '#ff4444' }}>{error}</div>;
    if (!plan) return <div style={styles.container}>Plan not found.</div>;

    const displayAmount = (plan.usdc_amount / 10000000).toFixed(2);

    return (
        <div style={styles.container}>
            <AnimatePresence mode="wait">
                {success ? (
                    <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        style={styles.successState}
                    >
                        <motion.div 
                            initial={{ scale: 0 }} 
                            animate={{ scale: 1 }} 
                            transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
                            style={styles.checkmark}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20 6L9 17L4 12" stroke="#000000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </motion.div>
                        <h2 style={styles.successTitle}>Payment Approved</h2>
                        <p style={styles.successSubtitle}>You are now subscribed to {plan.name}.</p>
                    </motion.div>
                ) : (
                    <motion.div
                        key="checkout"
                        exit={{ opacity: 0, scale: 0.95, filter: 'blur(4px)' }}
                        transition={{ duration: 0.3 }}
                    >
                        <div style={styles.header}>
                            <h2 style={styles.title}>{plan.name}</h2>
                            <p style={styles.merchant}>by {plan.merchants?.name}</p>
                        </div>
                        
                        <div style={styles.priceContainer}>
                            <span style={styles.price}>${displayAmount}</span>
                            <span style={styles.currency}> USDC</span>
                        </div>
                        
                        <div style={styles.interval}>
                            Billed every {plan.interval_seconds / 86400} days
                        </div>

                        {!userAddress ? (
                            <button style={styles.primaryButton} onClick={handleConnect}>
                                Connect Freighter Wallet
                            </button>
                        ) : (
                            <>
                                <div style={styles.connectedText}>
                                    <span style={styles.connectedDot}></span>
                                    {userAddress.slice(0, 5)}...{userAddress.slice(-4)}
                                </div>
                                <button 
                                    style={{ ...styles.primaryButton, opacity: isSubscribing ? 0.7 : 1 }} 
                                    onClick={handleSubscribe}
                                    disabled={isSubscribing}
                                >
                                    {isSubscribing ? "Approving..." : "Subscribe & Approve"}
                                </button>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// Strict Brand.md styling
const styles = {
    container: {
        backgroundColor: '#000000', // Black
        border: '1px solid #2C2C2C', // Black Ash
        padding: '32px 24px',
        borderRadius: '12px',
        maxWidth: '340px',
        fontFamily: "'Inter', sans-serif",
        color: '#FFFFFF', // White text
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
    },
    header: {
        marginBottom: '24px'
    },
    title: {
        margin: '0 0 8px 0',
        fontSize: '20px',
        fontWeight: '500',
        letterSpacing: '-0.02em'
    },
    merchant: {
        margin: 0,
        color: '#888888',
        fontSize: '14px'
    },
    priceContainer: {
        marginBottom: '8px'
    },
    price: {
        fontSize: '40px',
        fontWeight: '700',
        letterSpacing: '-0.04em'
    },
    currency: {
        fontSize: '16px',
        color: '#888888',
        fontWeight: '500'
    },
    interval: {
        fontSize: '14px',
        color: '#888888',
        marginBottom: '32px'
    },
    primaryButton: {
        width: '100%',
        padding: '14px',
        backgroundColor: '#FFFFFF', // White background
        color: '#000000', // Black text
        border: 'none',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'opacity 0.2s ease',
        letterSpacing: '-0.01em'
    },
    connectedText: {
        fontSize: '13px',
        color: '#FFFFFF',
        marginBottom: '16px',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px'
    },
    connectedDot: {
        width: '8px',
        height: '8px',
        backgroundColor: '#FFFFFF',
        borderRadius: '50%'
    },
    successState: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 0'
    },
    checkmark: {
        width: '48px',
        height: '48px',
        backgroundColor: '#FFFFFF',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '20px'
    },
    successTitle: {
        margin: '0 0 8px 0',
        fontSize: '22px',
        fontWeight: '600',
        letterSpacing: '-0.02em'
    },
    successSubtitle: {
        margin: 0,
        color: '#888888',
        fontSize: '15px'
    }
};

export default OrbitCheckout;
