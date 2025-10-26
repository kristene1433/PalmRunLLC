const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Payment = require('../models/Payment');
const User = require('../models/User');
const Application = require('../models/Application');
const { auth } = require('../middleware/auth');
const router = express.Router();
const webhookRouter = express.Router();

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const padMonth = (value) => String(value).padStart(2, '0');

const parseDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value);
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const getMonthKey = (date) => {
  const safeDate = new Date(date);
  return `${safeDate.getUTCFullYear()}-${padMonth(safeDate.getUTCMonth() + 1)}`;
};

const calculateAccrualAllocations = (application) => {
  const allocations = {};
  const nightsByMonth = {};

  const leaseStart = parseDateOnly(application.leaseStartDate || application.requestedStartDate);
  const leaseEnd = parseDateOnly(application.leaseEndDate || application.requestedEndDate);

  if (!leaseStart || !leaseEnd || leaseEnd < leaseStart) {
    return { allocations, nightsByMonth };
  }

  const monthlyRent = Number(application.rentalAmount || 0);
  if (!monthlyRent) {
    return { allocations, nightsByMonth };
  }

  let currentMonth = new Date(Date.UTC(leaseStart.getUTCFullYear(), leaseStart.getUTCMonth(), 1));
  const finalMonth = new Date(Date.UTC(leaseEnd.getUTCFullYear(), leaseEnd.getUTCMonth(), 1));

  while (currentMonth <= finalMonth) {
    const monthStart = new Date(currentMonth);
    const monthEnd = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 0));

    const activeStart = new Date(Math.max(monthStart.getTime(), leaseStart.getTime()));
    const activeEnd = new Date(Math.min(monthEnd.getTime(), leaseEnd.getTime()));

    if (activeEnd < activeStart) {
      currentMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1));
      continue;
    }

    const activeDays = Math.round((activeEnd - activeStart) / DAY_IN_MS) + 1;
    const daysInMonth = Math.round((monthEnd - monthStart) / DAY_IN_MS) + 1;

    if (activeDays <= 0 || daysInMonth <= 0) {
      currentMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1));
      continue;
    }

    const proratedAmount = monthlyRent * (activeDays / daysInMonth);
    const cents = Math.round(proratedAmount * 100);
    const monthKey = getMonthKey(monthStart);

    allocations[monthKey] = (allocations[monthKey] || 0) + cents;
    nightsByMonth[monthKey] = (nightsByMonth[monthKey] || 0) + activeDays;

    currentMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + 1, 1));
  }

  return { allocations, nightsByMonth };
};

const getPeriodConfig = (period, year, month) => {
  if (period === 'year' && year) {
    return { type: 'year', year: parseInt(year, 10) };
  }
  if (period === 'month' && year && month) {
    return { type: 'month', year: parseInt(year, 10), month: parseInt(month, 10) };
  }
  return { type: 'all' };
};

const monthMatchesPeriod = (monthKey, periodConfig) => {
  if (periodConfig.type === 'year') {
    return monthKey.startsWith(`${periodConfig.year}-`);
  }
  if (periodConfig.type === 'month') {
    const expected = `${periodConfig.year}-${padMonth(periodConfig.month)}`;
    return monthKey === expected;
  }
  return true;
};

// Stripe webhook handler for payment completion - MUST use raw body
async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  console.log('=== WEBHOOK RECEIVED ===');
  console.log('Webhook received:', req.headers['stripe-signature'] ? 'with signature' : 'without signature');
  console.log('Webhook endpoint secret exists:', !!endpointSecret);
  console.log('Request body length:', req.body?.length || 'no body');
  console.log('Content-Type:', req.headers['content-type']);

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('Webhook event type:', event.type);
    console.log('Webhook event ID:', event.id);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      
      console.log('Processing checkout.session.completed webhook');
      console.log('Session metadata keys:', Object.keys(session.metadata || {}));
      console.log('Session payment intent:', session.payment_intent);
      
      try {
        // Create payment record from session metadata
        const payment = new Payment({
          userId: session.metadata.userId,
          applicationId: session.metadata.applicationId,
          stripePaymentIntentId: session.payment_intent,
          stripeCustomerId: session.customer,
          amount: Math.round(parseFloat(session.metadata.amount) * 100), // Convert to cents
          creditCardFee: Math.round(parseFloat(session.metadata.creditCardFee || 0) * 100), // Convert to cents
          totalAmount: session.amount_total,
          currency: 'usd',
          paymentType: session.metadata.paymentType,
          description: `${session.metadata.paymentType} payment`,
          status: 'succeeded',
          paidAt: new Date(),
          metadata: {
            propertyAddress: session.metadata.propertyAddress,
            checkoutSessionId: session.id
          }
        });
        
        console.log('Created payment object:', {
          userId: payment.userId,
          applicationId: payment.applicationId,
          amount: payment.amount,
          status: payment.status
        });

        // Get payment intent details for additional info
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
        const charge = paymentIntent.charges?.data?.[0];
        if (charge?.payment_method_details?.card) {
          const card = charge.payment_method_details.card;
          payment.cardLast4 = card.last4;
          payment.cardBrand = card.brand;
        }

        // Get receipt URL from charge if available
        payment.receiptUrl = payment.receiptUrl || charge?.receipt_url || null;

        await payment.save();
        console.log(`Payment ${payment._id} saved to database successfully`);
        
        // Update application to mark payment as received
        if (session.metadata.applicationId) {
          const updateResult = await Application.findByIdAndUpdate(
            session.metadata.applicationId,
            { 
              paymentReceived: true,
              lastUpdated: new Date()
            }
          );
          console.log(`Updated application ${session.metadata.applicationId} with paymentReceived: true`);
          console.log('Application update result:', updateResult ? 'success' : 'failed');
        }
        
        console.log(`Payment ${payment._id} created and marked as successful`);
        console.log(`Updated application ${session.metadata.applicationId} with paymentReceived: true`);
      } catch (error) {
        console.error('Error processing webhook:', error);
      }
      break;

    case 'payment_intent.payment_failed':
      const paymentIntent = event.data.object;
      
      try {
        const payment = await Payment.findOne({ 
          stripePaymentIntentId: paymentIntent.id 
        });

        if (payment) {
          payment.status = 'failed';
          payment.failedAt = new Date();
          payment.error = {
            code: paymentIntent.last_payment_error?.code || 'payment_failed',
            message: paymentIntent.last_payment_error?.message || 'Payment failed'
          };
          await payment.save();
          console.log(`Payment ${payment._id} marked as failed`);
        }
      } catch (error) {
        console.error('Error processing failed payment webhook:', error);
      }
      break;

    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      try {
        let payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
        if (!payment) {
          // Use metadata if available, otherwise use payment intent amount
          const amountFromMetadata = pi.metadata?.amount ? Math.round(parseFloat(pi.metadata.amount) * 100) : pi.amount;
          const creditCardFeeFromMetadata = pi.metadata?.creditCardFee ? Math.round(parseFloat(pi.metadata.creditCardFee) * 100) : 0;
          const totalAmountFromMetadata = pi.metadata?.totalAmount ? Math.round(parseFloat(pi.metadata.totalAmount) * 100) : pi.amount;
          
          payment = new Payment({
            userId: pi.metadata?.userId,
            applicationId: pi.metadata?.applicationId,
            stripePaymentIntentId: pi.id,
            stripeCustomerId: pi.customer,
            amount: amountFromMetadata,
            creditCardFee: creditCardFeeFromMetadata,
            totalAmount: totalAmountFromMetadata,
            currency: pi.currency || 'usd',
            paymentType: pi.metadata?.paymentType || 'deposit',
            description: `${pi.metadata?.paymentType || 'deposit'} payment`,
            status: 'succeeded',
            paidAt: new Date(),
            metadata: {
              propertyAddress: pi.metadata?.propertyAddress,
              checkoutSessionId: pi.metadata?.checkoutSessionId
            }
          });
        } else {
          payment.status = 'succeeded';
          payment.paidAt = new Date();
          // Update amount if it's still 0 (from previous incorrect processing)
          if (payment.amount === 0) {
            const amountFromMetadata = pi.metadata?.amount ? Math.round(parseFloat(pi.metadata.amount) * 100) : pi.amount;
            const creditCardFeeFromMetadata = pi.metadata?.creditCardFee ? Math.round(parseFloat(pi.metadata.creditCardFee) * 100) : 0;
            const totalAmountFromMetadata = pi.metadata?.totalAmount ? Math.round(parseFloat(pi.metadata.totalAmount) * 100) : pi.amount;
            
            payment.amount = amountFromMetadata;
            payment.creditCardFee = creditCardFeeFromMetadata;
            payment.totalAmount = totalAmountFromMetadata;
          }
        }
        const charge = pi.charges?.data?.[0];
        payment.receiptUrl = charge?.receipt_url || payment.receiptUrl;
        if (charge?.payment_method_details?.card) {
          payment.cardBrand = charge.payment_method_details.card.brand;
          payment.cardLast4 = charge.payment_method_details.card.last4;
        }
        await payment.save();
        
        // Update application to mark payment as received
        if (pi.metadata?.applicationId) {
          await Application.findByIdAndUpdate(
            pi.metadata.applicationId,
            { 
              paymentReceived: true,
              lastUpdated: new Date()
            }
          );
          console.log(`Updated application ${pi.metadata.applicationId} with paymentReceived: true`);
        }
      } catch (err) {
        console.error('payment_intent.succeeded handling error:', err);
      }
      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
}

// Mount webhook with raw body parser on dedicated router
webhookRouter.post('/', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Test webhook endpoint
webhookRouter.get('/test', (req, res) => {
  console.log('Webhook test endpoint hit');
  res.json({ message: 'Webhook endpoint is working', timestamp: new Date().toISOString() });
});

// Test payment creation endpoint
router.post('/test-payment', auth, async (req, res) => {
  try {
    const { amount, applicationId } = req.body;
    
    console.log('=== TEST PAYMENT CREATION ===');
    console.log('Amount:', amount);
    console.log('Application ID:', applicationId);
    console.log('User ID:', req.user._id);
    
    // Create a test payment record
    const payment = new Payment({
      userId: req.user._id,
      applicationId: applicationId,
      stripePaymentIntentId: 'test_' + Date.now(),
      stripeCustomerId: 'test_customer',
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      paymentType: 'deposit',
      description: 'Test payment',
      status: 'succeeded',
      paidAt: new Date(),
      metadata: {
        propertyAddress: 'Test Address',
        checkoutSessionId: 'test_session'
      }
    });
    
    await payment.save();
    console.log('Test payment saved:', payment._id);
    
    // Update application to mark payment as received
    if (applicationId) {
      await Application.findByIdAndUpdate(applicationId, {
        paymentReceived: true,
        lastUpdated: new Date()
      });
      console.log('Updated application with paymentReceived: true');
    }
    
    res.json({ 
      message: 'Test payment created successfully', 
      payment: payment,
      applicationUpdated: !!applicationId
    });
  } catch (error) {
    console.error('Test payment creation error:', error);
    res.status(500).json({ error: 'Test payment creation failed', details: error.message });
  }
});

// Create Stripe Checkout session
router.post('/create-checkout-session', auth, async (req, res) => {
  try {
    const { amount, creditCardFee = 0, totalAmount, paymentType = 'deposit', description, successUrl, cancelUrl, applicationId } = req.body;
    
    console.log('=== CREATE CHECKOUT SESSION ===');
    console.log('Request body:', { amount, paymentType, description, applicationId });
    console.log('User ID:', req.user._id);
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Get user information
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create or retrieve Stripe customer
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: user.email,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: user.email,
        name: user.getFullName(),
        phone: user.phone,
        metadata: {
          userId: user._id.toString(),
          propertyAddress: user.getFullAddress()
        }
      });
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: paymentType === 'deposit' ? 'Security Deposit' : 'Rent Payment',
              description: description || `${paymentType} payment for ${user.getFullName()}`,
              metadata: {
                paymentType,
                userId: user._id.toString()
              }
            },
            unit_amount: Math.round((totalAmount || amount) * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl || `${process.env.CLIENT_URL || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.CLIENT_URL || 'http://localhost:3000'}/payment/cancel`,
      metadata: {
        userId: user._id.toString(),
        applicationId: applicationId,
        paymentType,
        amount: amount.toString(),
        creditCardFee: creditCardFee.toString(),
        totalAmount: (totalAmount || amount).toString(),
        propertyAddress: user.getFullAddress()
      },
      billing_address_collection: 'required',
      payment_intent_data: {
        metadata: {
          userId: user._id.toString(),
          applicationId: applicationId,
          paymentType,
          amount: amount.toString(),
          creditCardFee: creditCardFee.toString(),
          totalAmount: (totalAmount || amount).toString(),
          propertyAddress: user.getFullAddress()
        }
      }
    });

    // Don't create payment record here - it will be created when webhook fires
    // The session metadata contains all the information we need

    res.json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Checkout session creation error:', error);
    res.status(500).json({ error: 'Server error creating checkout session' });
  }
});

// Confirm payment
router.post('/confirm', auth, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    const payment = await Payment.findOne({ 
      stripePaymentIntentId: paymentIntentId,
      userId: req.user._id
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === 'succeeded') {
      // Update payment status
      payment.status = 'succeeded';
      payment.paidAt = new Date();
      payment.receiptUrl = paymentIntent.charges.data[0]?.receipt_url;
      
      if (paymentIntent.charges.data[0]?.payment_method_details?.card) {
        const card = paymentIntent.charges.data[0].payment_method_details.card;
        payment.cardLast4 = card.last4;
        payment.cardBrand = card.brand;
      }

      await payment.save();

      res.json({
        message: 'Payment confirmed successfully',
        payment,
        receiptUrl: payment.receiptUrl
      });
    } else if (paymentIntent.status === 'requires_payment_method') {
      payment.status = 'failed';
      payment.failedAt = new Date();
      payment.error = {
        code: 'payment_method_required',
        message: 'Payment method is required'
      };
      await payment.save();

      res.status(400).json({
        error: 'Payment method is required',
        payment
      });
    } else {
      res.status(400).json({
        error: 'Payment not completed',
        status: paymentIntent.status
      });
    }
  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ error: 'Server error confirming payment' });
  }
});

// Debug endpoint to check all payments in database
router.get('/debug/all-payments', auth, async (req, res) => {
  try {
    const allPayments = await Payment.find({}).sort({ createdAt: -1 });
    console.log(`Found ${allPayments.length} total payments in database`);
    
    res.json({ 
      totalPayments: allPayments.length,
      payments: allPayments.map(p => ({
        _id: p._id,
        userId: p.userId,
        applicationId: p.applicationId,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt
      }))
    });
  } catch (error) {
    console.error('Debug payments fetch error:', error);
    res.status(500).json({ error: 'Server error fetching all payments' });
  }
});

// Get payment history
router.get('/history', auth, async (req, res) => {
  try {
    const { applicationId } = req.query;
    
    let query = { userId: req.user._id };
    
    if (applicationId) {
      // For application-specific payments, only include payments with the specific applicationId
      query.applicationId = applicationId;
    }
    
    console.log('Fetching payment history with query:', query);
    
    const payments = await Payment.find(query)
      .sort({ createdAt: -1 });

    console.log(`Found ${payments.length} payments for user ${req.user._id}, application ${applicationId}`);
    res.json({ payments });
  } catch (error) {
    console.error('Payment history fetch error:', error);
    res.status(500).json({ error: 'Server error fetching payment history' });
  }
});

// Get payment details by Checkout Session ID
router.get('/by-session/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    let payment = await Payment.findOne({
      userId: req.user._id,
      'metadata.checkoutSessionId': sessionId
    });

    // If the webhook hasn't written the payment yet, pull details directly from Stripe
    if (!payment) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session) return res.status(404).json({ error: 'Stripe session not found' });

        const pi = session.payment_intent
          ? await stripe.paymentIntents.retrieve(session.payment_intent)
          : null;

        const amount = session.amount_total || (pi ? pi.amount : undefined);
        const receiptUrl = pi?.charges?.data?.[0]?.receipt_url || null;
        const card = pi?.charges?.data?.[0]?.payment_method_details?.card;

        return res.json({
          payment: {
            amount: amount ?? 0,
            currency: 'usd',
            paymentType: session?.metadata?.paymentType || 'deposit',
            description: `${session?.metadata?.paymentType || 'deposit'} payment`,
            status: pi?.status === 'succeeded' ? 'succeeded' : 'processing',
            paidAt: pi?.status === 'succeeded' ? new Date() : null,
            createdAt: new Date(),
            stripePaymentIntentId: pi?.id || session?.payment_intent || sessionId,
            cardBrand: card?.brand,
            cardLast4: card?.last4
          },
          receiptUrl
        });
      } catch (e) {
        console.error('Stripe lookup for by-session failed:', e);
        return res.status(404).json({ error: 'Payment not found for session' });
      }
    }

    return res.json({ payment, receiptUrl: payment.receiptUrl || null });
  } catch (error) {
    console.error('Payment by-session fetch error:', error);
    res.status(500).json({ error: 'Server error fetching payment details' });
  }
});

// Get payment by ID
router.get('/:paymentId', auth, async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findOne({
      _id: paymentId,
      userId: req.user._id
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json({ payment });
  } catch (error) {
    console.error('Payment fetch error:', error);
    res.status(500).json({ error: 'Server error fetching payment' });
  }
});

// Cancel payment
router.post('/:paymentId/cancel', auth, async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const payment = await Payment.findOne({
      _id: paymentId,
      userId: req.user._id
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending payments can be canceled' });
    }

    // Cancel payment intent in Stripe
    try {
      await stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
    } catch (stripeError) {
      console.error('Stripe cancel error:', stripeError);
    }

    // Update payment status
    payment.status = 'canceled';
    await payment.save();

    res.json({
      message: 'Payment canceled successfully',
      payment
    });
  } catch (error) {
    console.error('Payment cancellation error:', error);
    res.status(500).json({ error: 'Server error canceling payment' });
  }
});

// Create payment intent for deposit
router.post('/create-payment-intent', auth, async (req, res) => {
  try {
    const { amount, paymentType = 'deposit', description } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Get user information
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create or retrieve Stripe customer
    let customer;
    const existingCustomers = await stripe.customers.list({
      email: user.email,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email: user.email,
        name: user.getFullName(),
        phone: user.phone,
        metadata: {
          userId: user._id.toString(),
          propertyAddress: user.getFullAddress()
        }
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      customer: customer.id,
      description: description || `${paymentType} payment for ${user.getFullName()}`,
      metadata: {
        userId: user._id.toString(),
        paymentType,
        propertyAddress: user.getFullAddress()
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Create payment record in database
    const payment = new Payment({
      userId: user._id,
      applicationId: req.body.applicationId,
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId: customer.id,
      amount: Math.round(amount * 100), // Store in cents
      currency: 'usd',
      paymentType,
      description: description || `${paymentType} payment`,
      status: 'pending',
      metadata: {
        propertyAddress: user.getFullAddress()
      }
    });

    await payment.save();

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      customerId: customer.id,
      payment: {
        id: payment._id,
        amount: payment.amount,
        status: payment.status
      }
    });
  } catch (error) {
    console.error('Payment intent creation error:', error);
    res.status(500).json({ error: 'Server error creating payment intent' });
  }
});

// Admin: Get all payments
router.get('/admin/all', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const payments = await Payment.find()
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({ payments });
  } catch (error) {
    console.error('Admin payments fetch error:', error);
    res.status(500).json({ error: 'Server error fetching payments' });
  }
});

// Get payment history for a specific tenant (Admin only)
router.get('/admin/history/:userId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId } = req.params;
    const { applicationId } = req.query;
    
    let query = { userId };
    
    if (applicationId) {
      // Filter by specific application if provided
      query.applicationId = applicationId;
    }
    
    const payments = await Payment.find(query)
      .populate('applicationId', 'firstName lastName requestedStartDate requestedEndDate')
      .sort({ createdAt: -1 });

    console.log('Admin payment history query:', {
      query,
      foundPayments: payments.length,
      paymentIds: payments.map(p => p._id)
    });

    res.json({ payments });
  } catch (error) {
    console.error('Admin tenant payment history fetch error:', error);
    res.status(500).json({ error: 'Server error fetching tenant payment history' });
  }
});

// Get available deposits for transfer (user's own applications only)
router.get('/available-deposits', auth, async (req, res) => {
  try {
    const { applicationId } = req.query;
    
    if (!applicationId) {
      return res.status(400).json({ error: 'Application ID is required' });
    }

    // Get all successful deposit payments for this user
    const deposits = await Payment.find({
      userId: req.user._id,
      paymentType: 'deposit',
      status: 'succeeded',
      isDepositTransfer: false // Exclude already transferred deposits
    })
    .populate('applicationId', 'firstName lastName requestedStartDate requestedEndDate')
    .sort({ createdAt: -1 });

    // Filter out deposits that have already been transferred
    const availableDeposits = deposits.filter(deposit => {
      // Check if this deposit has been transferred
      return !deposit.transferredToApplicationId;
    });

    res.json({ deposits: availableDeposits });
  } catch (error) {
    console.error('Available deposits fetch error:', error);
    res.status(500).json({ error: 'Server error fetching available deposits' });
  }
});

// Admin: Get applications with available payments for transfer (any user)
router.get('/admin/available-deposits', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get all successful payments for this user (not just deposits)
    const payments = await Payment.find({
      userId: userId,
      status: 'succeeded'
      // Removed isDepositTransfer filter to include all payments
    })
    .populate('applicationId', 'firstName lastName requestedStartDate requestedEndDate applicationNumber')
    .sort({ createdAt: -1 });

    console.log(`Found ${payments.length} total successful payments for user ${userId}`);
    payments.forEach(payment => {
      console.log(`Payment: ${payment._id}, App: ${payment.applicationId?._id}, Amount: $${(payment.amount / 100).toFixed(2)}, Type: ${payment.paymentType}, Transfer: ${payment.isDepositTransfer}`);
    });

    // Filter out payments that have already been transferred and group by application
    const availablePayments = payments.filter(payment => {
      return !payment.transferredToApplicationId;
    });

    console.log(`After filtering transfers: ${availablePayments.length} available payments`);

    // Group payments by application and calculate total balance for each
    const applicationBalances = {};
    availablePayments.forEach(payment => {
      const appId = payment.applicationId._id.toString();
      if (!applicationBalances[appId]) {
        applicationBalances[appId] = {
          applicationId: payment.applicationId,
          totalBalance: 0,
          paymentCount: 0
        };
      }
      applicationBalances[appId].totalBalance += payment.amount;
      applicationBalances[appId].paymentCount += 1;
    });

    console.log(`Grouped into ${Object.keys(applicationBalances).length} applications with balances`);

    // Convert to array format for frontend
    const deposits = Object.values(applicationBalances).map(balance => ({
      _id: balance.applicationId._id,
      applicationId: balance.applicationId,
      amount: balance.totalBalance,
      paymentCount: balance.paymentCount
    }));

    console.log(`Returning ${deposits.length} applications with balances:`, deposits.map(d => ({
      appId: d.applicationId._id,
      appNumber: d.applicationId.applicationNumber,
      amount: (d.amount / 100).toFixed(2),
      paymentCount: d.paymentCount
    })));

    res.json({ deposits });
  } catch (error) {
    console.error('Admin available payments fetch error:', error);
    res.status(500).json({ error: 'Server error fetching available payments' });
  }
});

// Admin: Get revenue summary
router.get('/admin/revenue-summary', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { period = 'all', year, month } = req.query;
    const periodConfig = getPeriodConfig(period, year, month);

    // Build date filter based on period
    let dateFilter = {};
    if (period === 'year' && year) {
      dateFilter.paidAt = {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${parseInt(year) + 1}-01-01`)
      };
    } else if (period === 'month' && year && month) {
      dateFilter.paidAt = {
        $gte: new Date(`${year}-${month}-01`),
        $lt: new Date(`${year}-${parseInt(month) + 1}-01`)
      };
    }

    // Get all successful payments
    const payments = await Payment.find({
      status: 'succeeded',
      ...dateFilter
    })
    .populate('applicationId', 'firstName lastName applicationNumber')
    .populate('userId', 'firstName lastName email')
    .sort({ paidAt: -1 });

    // Calculate revenue metrics
    const totalRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const netRevenue = payments.reduce((sum, payment) => sum + (payment.amount - (payment.creditCardFee || 0)), 0);
    const totalFees = payments.reduce((sum, payment) => sum + (payment.creditCardFee || 0), 0);
    const refundsTotal = payments
      .filter(payment => payment.paymentType === 'refund' || payment.amount < 0)
      .reduce((sum, payment) => sum + Math.abs(payment.amount), 0);

    // Revenue by payment type
    const revenueByType = payments.reduce((acc, payment) => {
      const type = payment.paymentType;
      if (!acc[type]) {
        acc[type] = { count: 0, amount: 0 };
      }
      acc[type].count += 1;
      acc[type].amount += payment.amount;
      return acc;
    }, {});

    // Monthly revenue breakdown (last 12 months)
    const monthlyRevenue = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyRevenue[monthKey] = 0;
    }

    payments.forEach(payment => {
      if (payment.paidAt) {
        const date = new Date(payment.paidAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyRevenue.hasOwnProperty(monthKey)) {
          monthlyRevenue[monthKey] += payment.amount;
        }
      }
    });

    // Gather deposit refund data to adjust outstanding balances
    const depositRefundPayments = await Payment.find({
      paymentType: 'refund',
      refundCategory: 'deposit',
      applicationId: { $exists: true, $ne: null }
    }).select('applicationId amount refundAmount refundCategory');

    const depositRefundMap = depositRefundPayments.reduce((map, refund) => {
      if (!refund.applicationId) return map;
      const key = refund.applicationId.toString();
      const cents = Math.abs(refund.amount || refund.refundAmount || 0);
      map[key] = (map[key] || 0) + cents;
      return map;
    }, {});

    // Gather lease data for accrual calculations
    const applications = await Application.find({
      leaseGenerated: true,
      leaseStartDate: { $exists: true, $ne: null },
      leaseEndDate: { $exists: true, $ne: null }
    }).select('leaseStartDate leaseEndDate requestedStartDate requestedEndDate rentalAmount depositAmount');

    const accrualTimeline = {};
    const occupancyTimeline = {};
    let outstandingDeposits = 0;
    let releasedDeposits = 0;
    const nowDate = new Date();

    applications.forEach((application) => {
      const { allocations, nightsByMonth } = calculateAccrualAllocations(application);

      Object.entries(allocations).forEach(([monthKey, amount]) => {
        accrualTimeline[monthKey] = (accrualTimeline[monthKey] || 0) + amount;
      });

      Object.entries(nightsByMonth).forEach(([monthKey, nights]) => {
        occupancyTimeline[monthKey] = (occupancyTimeline[monthKey] || 0) + nights;
      });

      const depositCents = Math.round(Number(application.depositAmount || 0) * 100);
      if (depositCents > 0) {
        const appId = application._id?.toString();
        const refundedCents = Math.min(depositRefundMap[appId] || 0, depositCents);
        const heldDeposit = Math.max(0, depositCents - refundedCents);
        const leaseEnd = parseDateOnly(application.leaseEndDate || application.requestedEndDate);

        releasedDeposits += refundedCents;

        if (leaseEnd && leaseEnd > nowDate) {
          outstandingDeposits += heldDeposit;
        } else if (leaseEnd) {
          releasedDeposits += heldDeposit;
        }
      }
    });

    // Filter accrual totals based on requested period
    let totalAccrualEarned = 0;
    let totalOccupiedNights = 0;
    const monthsCovered = new Set();

    Object.entries(accrualTimeline).forEach(([monthKey, amount]) => {
      if (monthMatchesPeriod(monthKey, periodConfig)) {
        totalAccrualEarned += amount;
        monthsCovered.add(monthKey);
      }
    });

    Object.entries(occupancyTimeline).forEach(([monthKey, nights]) => {
      if (monthMatchesPeriod(monthKey, periodConfig)) {
        totalOccupiedNights += nights;
        monthsCovered.add(monthKey);
      }
    });

    const monthsInPeriod = monthsCovered.size || (periodConfig.type === 'month'
      ? 1
      : periodConfig.type === 'year'
        ? 12
        : Object.keys(accrualTimeline).length || 1);

    const averageMonthlyEarned = monthsInPeriod > 0
      ? Math.round(totalAccrualEarned / monthsInPeriod)
      : 0;
    const averageNightlyRate = totalOccupiedNights > 0
      ? Math.round(totalAccrualEarned / totalOccupiedNights)
      : 0;

    const currentMonthKey = getMonthKey(new Date());
    let upcomingRevenue = 0;
    Object.entries(accrualTimeline).forEach(([monthKey, amount]) => {
      if (monthKey > currentMonthKey) {
        upcomingRevenue += amount;
      }
    });

    const accrualMonthlyRevenue = {};
    const occupancyByMonth = {};
    Object.keys(monthlyRevenue).forEach((monthKey) => {
      accrualMonthlyRevenue[monthKey] = accrualTimeline[monthKey] || 0;
      occupancyByMonth[monthKey] = occupancyTimeline[monthKey] || 0;
    });

    res.json({
      summary: {
        totalRevenue,
        netRevenue,
        totalFees,
        refundsTotal,
        paymentCount: payments.length,
        averagePayment: payments.length > 0 ? totalRevenue / payments.length : 0
      },
      revenueByType,
      monthlyRevenue,
      accrualMonthlyRevenue,
      occupancyByMonth,
      accrualSummary: {
        totalEarned: totalAccrualEarned,
        occupiedNights: totalOccupiedNights,
        averageMonthlyEarned,
        averageNightlyRate,
        monthsInPeriod,
        outstandingDeposits,
        releasedDeposits,
        upcomingRevenue
      },
      accrualTimeline,
      occupancyTimeline,
      payments: payments.slice(0, 50) // Return recent payments for detailed view
    });
  } catch (error) {
    console.error('Revenue summary fetch error:', error);
    res.status(500).json({ error: 'Server error fetching revenue summary' });
  }
});

// Admin: Get all user applications for transfer destination selection
router.get('/admin/user-applications', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Get all applications for this user
    const applications = await Application.find({
      userId: userId
    })
    .select('firstName lastName requestedStartDate requestedEndDate applicationNumber status paymentReceived createdAt')
    .sort({ createdAt: -1 });

    res.json({ applications });
  } catch (error) {
    console.error('Admin user applications fetch error:', error);
    res.status(500).json({ error: 'Server error fetching user applications' });
  }
});

// Transfer deposit from one application to another
router.post('/transfer-deposit', auth, async (req, res) => {
  try {
    const { 
      fromApplicationId, 
      toApplicationId, 
      depositAmount, 
      transferNotes 
    } = req.body;

    if (!fromApplicationId || !toApplicationId || !depositAmount) {
      return res.status(400).json({ 
        error: 'fromApplicationId, toApplicationId, and depositAmount are required' 
      });
    }

    // Verify both applications belong to the user
    const [fromApp, toApp] = await Promise.all([
      Application.findOne({ _id: fromApplicationId, userId: req.user._id }),
      Application.findOne({ _id: toApplicationId, userId: req.user._id })
    ]);

    if (!fromApp) {
      return res.status(404).json({ error: 'Source application not found' });
    }

    if (!toApp) {
      return res.status(404).json({ error: 'Destination application not found' });
    }

    // Find the original deposit payment
    const originalDeposit = await Payment.findOne({
      userId: req.user._id,
      applicationId: fromApplicationId,
      paymentType: 'deposit',
      status: 'succeeded',
      isDepositTransfer: false
    });

    if (!originalDeposit) {
      return res.status(404).json({ error: 'No deposit found in source application' });
    }

    // Check if deposit amount is valid
    if (depositAmount > originalDeposit.amount) {
      return res.status(400).json({ 
        error: 'Transfer amount cannot exceed original deposit amount' 
      });
    }

    // Create transfer record
    const transferPayment = new Payment({
      userId: req.user._id,
      applicationId: toApplicationId,
      stripePaymentIntentId: `transfer_${Date.now()}`, // Unique ID for transfer
      stripeCustomerId: originalDeposit.stripeCustomerId,
      amount: depositAmount,
      currency: 'usd',
      paymentType: 'deposit_transfer',
      description: `Deposit transfer from ${fromApp.requestedStartDate ? new Date(fromApp.requestedStartDate).getFullYear() : 'previous'} to ${toApp.requestedStartDate ? new Date(toApp.requestedStartDate).getFullYear() : 'current'} application`,
      status: 'succeeded',
      paidAt: new Date(),
      isDepositTransfer: true,
      transferredFromApplicationId: fromApplicationId,
      transferredToApplicationId: toApplicationId,
      originalDepositAmount: originalDeposit.amount,
      transferNotes: transferNotes || '',
      metadata: {
        propertyAddress: toApp.address,
        leaseStartDate: toApp.requestedStartDate,
        leaseEndDate: toApp.requestedEndDate,
        notes: `Transferred from application ${fromApplicationId}`
      }
    });

    await transferPayment.save();

    // Update the destination application to mark payment as received
    toApp.paymentReceived = true;
    toApp.lastUpdated = new Date();
    await toApp.save();

    // Mark the original deposit as transferred
    originalDeposit.transferredToApplicationId = toApplicationId;
    await originalDeposit.save();

    console.log(`Deposit transfer completed: ${depositAmount} from ${fromApplicationId} to ${toApplicationId}`);

    res.json({ 
      message: 'Deposit transfer completed successfully',
      transfer: transferPayment
    });
  } catch (error) {
    console.error('Deposit transfer error:', error);
    res.status(500).json({ error: 'Server error processing deposit transfer' });
  }
});

// Admin: Record manual payment (e.g., check)
router.post('/admin/manual-payment', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      applicationId,
      amount,
      paymentType = 'rent',
      paymentDate,
      checkNumber = '',
      notes = ''
    } = req.body;

    if (!applicationId || amount === undefined) {
      return res.status(400).json({ error: 'Application ID and amount are required' });
    }

    const parsedAmount = parseFloat(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const application = await Application.findById(applicationId).populate('userId', 'email');
    if (!application || !application.userId) {
      return res.status(404).json({ error: 'Application or associated user not found' });
    }

    const cents = Math.round(parsedAmount * 100);
    const allowedTypes = ['deposit', 'rent', 'late_fee', 'other'];
    const normalizedType = allowedTypes.includes(paymentType) ? paymentType : 'other';

    const manualPayment = new Payment({
      userId: application.userId._id,
      applicationId: application._id,
      stripePaymentIntentId: `manual_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
      stripeCustomerId: `manual_${application.userId._id}`,
      amount: cents,
      creditCardFee: 0,
      totalAmount: cents,
      currency: 'usd',
      paymentType: normalizedType,
      description: notes?.trim() || `${normalizedType === 'deposit' ? 'Deposit' : normalizedType === 'rent' ? 'Rent' : 'Manual'} payment recorded by admin`,
      status: 'succeeded',
      paymentMethod: 'check',
      paidAt: paymentDate ? new Date(paymentDate) : new Date(),
      metadata: {
        notes: `Manual check${checkNumber ? ` #${checkNumber}` : ''}${notes ? ` - ${notes}` : ''}`.trim()
      }
    });

    await manualPayment.save();
    console.log('Manual payment saved:', {
      id: manualPayment._id,
      userId: manualPayment.userId,
      applicationId: manualPayment.applicationId,
      amount: manualPayment.amount,
      paymentType: manualPayment.paymentType
    });

    application.lastUpdated = new Date();
    if (normalizedType === 'deposit') {
      application.paymentReceived = true;
    }
    await application.save();

    res.json({ success: true, payment: manualPayment });
  } catch (error) {
    console.error('Admin manual payment error:', error);
    res.status(500).json({ error: 'Server error recording manual payment' });
  }
});

// Admin: Record manual refund (e.g., check)
router.post('/admin/manual-refund', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      applicationId,
      amount,
      refundType = 'deposit',
      refundDate,
      checkNumber = '',
      notes = '',
      originalPaymentId
    } = req.body;

    if (!applicationId || amount === undefined) {
      return res.status(400).json({ error: 'Application ID and amount are required' });
    }

    const parsedAmount = parseFloat(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const application = await Application.findById(applicationId).populate('userId', 'email');
    if (!application || !application.userId) {
      return res.status(404).json({ error: 'Application or associated user not found' });
    }

    const cents = Math.round(parsedAmount * 100);
    const negativeCents = cents * -1;
    const allowedRefundTypes = ['deposit', 'rent', 'other'];
    const normalizedRefundType = allowedRefundTypes.includes(refundType) ? refundType : 'other';

    const refundPayment = new Payment({
      userId: application.userId._id,
      applicationId: application._id,
      stripePaymentIntentId: `manual_refund_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
      stripeCustomerId: `manual_refund_${application.userId._id}`,
      amount: negativeCents,
      creditCardFee: 0,
      totalAmount: negativeCents,
      currency: 'usd',
      paymentType: 'refund',
      description: notes?.trim() || `${normalizedRefundType === 'deposit' ? 'Deposit' : normalizedRefundType === 'rent' ? 'Rent' : 'Manual'} refund issued by admin`,
      status: 'succeeded',
      paymentMethod: 'check',
      paidAt: refundDate ? new Date(refundDate) : new Date(),
      refunded: true,
      refundAmount: cents,
      refundReason: notes,
      refundedAt: refundDate ? new Date(refundDate) : new Date(),
      refundCategory: normalizedRefundType,
      originalPaymentId: originalPaymentId || undefined,
      metadata: {
        notes: `Manual refund check${checkNumber ? ` #${checkNumber}` : ''}${notes ? ` - ${notes}` : ''}`.trim()
      }
    });

    await refundPayment.save();

    application.lastUpdated = new Date();
    await application.save();

    res.json({ success: true, refund: refundPayment });
  } catch (error) {
    console.error('Admin manual refund error:', error);
    res.status(500).json({ error: 'Server error recording manual refund' });
  }
});

// Admin: Transfer amount from one application to another
router.post('/admin/transfer-amount', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { 
      fromApplicationId, 
      toApplicationId, 
      depositAmount, 
      transferNotes 
    } = req.body;

    if (!fromApplicationId || !toApplicationId || !depositAmount) {
      return res.status(400).json({ 
        error: 'fromApplicationId, toApplicationId, and depositAmount are required' 
      });
    }

    // Get both applications (admin can access any application)
    const [fromApp, toApp] = await Promise.all([
      Application.findById(fromApplicationId).populate('userId', 'email'),
      Application.findById(toApplicationId).populate('userId', 'email')
    ]);

    if (!fromApp) {
      return res.status(404).json({ error: 'Source application not found' });
    }

    if (!toApp) {
      return res.status(404).json({ error: 'Destination application not found' });
    }

    // Verify both applications belong to the same user
    if (fromApp.userId._id.toString() !== toApp.userId._id.toString()) {
      return res.status(400).json({ 
        error: 'Both applications must belong to the same user' 
      });
    }

    // Find any successful payments for the source application to validate available balance
    const sourcePayments = await Payment.find({
      userId: fromApp.userId._id,
      applicationId: fromApplicationId,
      status: 'succeeded'
    });

    if (sourcePayments.length === 0) {
      return res.status(404).json({ error: 'No payments found in source application' });
    }

    // Calculate total available balance from source application
    const totalSourceBalance = sourcePayments.reduce((sum, payment) => {
      return sum + payment.amount;
    }, 0);

    // Check if transfer amount is valid (admin can transfer any amount up to total balance)
    if (depositAmount > totalSourceBalance) {
      return res.status(400).json({ 
        error: `Transfer amount cannot exceed available balance of $${(totalSourceBalance / 100).toFixed(2)}` 
      });
    }

    // Create transfer record for destination (positive)
    const transferPayment = new Payment({
      userId: fromApp.userId._id,
      applicationId: toApplicationId,
      stripePaymentIntentId: `admin_transfer_${Date.now()}_to`, // Unique ID for admin transfer
      stripeCustomerId: sourcePayments[0].stripeCustomerId, // Use customer ID from source payments
      amount: depositAmount,
      totalAmount: depositAmount, // Set totalAmount to same as amount for admin transfers (no fees)
      currency: 'usd',
      paymentType: 'admin_transfer',
      description: `Admin transfer: $${(depositAmount / 100).toFixed(2)} from ${fromApp.applicationNumber || 'Previous'} to ${toApp.applicationNumber || 'Current'} application`,
      status: 'succeeded',
      paidAt: new Date(),
      isDepositTransfer: true,
      transferredFromApplicationId: fromApplicationId,
      transferredToApplicationId: toApplicationId,
      originalDepositAmount: depositAmount,
      transferNotes: transferNotes || '',
      metadata: {
        propertyAddress: toApp.address,
        leaseStartDate: toApp.requestedStartDate,
        leaseEndDate: toApp.requestedEndDate,
        notes: `Admin transferred $${(depositAmount / 100).toFixed(2)} from application ${fromApplicationId}`,
        adminTransferred: true
      }
    });

    // Create debit record for source (negative)
    const transferDebit = new Payment({
      userId: fromApp.userId._id,
      applicationId: fromApplicationId,
      stripePaymentIntentId: `admin_transfer_${Date.now()}_from`, // Unique ID for admin transfer
      stripeCustomerId: sourcePayments[0].stripeCustomerId, // Use customer ID from source payments
      amount: -depositAmount, // Negative amount to show as debit
      totalAmount: -depositAmount, // Negative amount to show as debit
      currency: 'usd',
      paymentType: 'admin_transfer',
      description: `Admin transfer: $${(depositAmount / 100).toFixed(2)} transferred to ${toApp.applicationNumber || 'Current'} application`,
      status: 'succeeded',
      paidAt: new Date(),
      isDepositTransfer: true,
      transferredFromApplicationId: fromApplicationId,
      transferredToApplicationId: toApplicationId,
      originalDepositAmount: depositAmount,
      transferNotes: transferNotes || '',
      metadata: {
        propertyAddress: fromApp.address,
        leaseStartDate: fromApp.requestedStartDate,
        leaseEndDate: fromApp.requestedEndDate,
        notes: `Admin transferred $${(depositAmount / 100).toFixed(2)} to application ${toApplicationId}`,
        adminTransferred: true
      }
    });

    // Save both records
    await Promise.all([transferPayment.save(), transferDebit.save()]);

    // Update the destination application to mark payment as received
    toApp.paymentReceived = true;
    toApp.lastUpdated = new Date();
    await toApp.save();

    console.log('Admin amount transfer completed', {
      amount: depositAmount,
      fromApplicationId,
      toApplicationId,
      userId: fromApp.userId._id
    });

    res.json({ 
      message: 'Amount transfer completed successfully',
      transfer: transferPayment
    });
  } catch (error) {
    console.error('Admin amount transfer error:', error);
    res.status(500).json({ error: 'Server error processing amount transfer' });
  }
});

// Get transfer history for an application
router.get('/transfer-history/:applicationId', auth, async (req, res) => {
  try {
    const { applicationId } = req.params;

    // Verify application belongs to user
    const application = await Application.findOne({ 
      _id: applicationId, 
      userId: req.user._id 
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Get all transfers related to this application
    const transfers = await Payment.find({
      $or: [
        { transferredToApplicationId: applicationId },
        { transferredFromApplicationId: applicationId }
      ],
      isDepositTransfer: true
    })
    .populate('transferredFromApplicationId', 'requestedStartDate requestedEndDate')
    .populate('transferredToApplicationId', 'requestedStartDate requestedEndDate')
    .sort({ createdAt: -1 });

    res.json({ transfers });
  } catch (error) {
    console.error('Transfer history fetch error:', error);
    res.status(500).json({ error: 'Server error fetching transfer history' });
  }
});

// Admin: Remove payment
router.delete('/admin/remove/:paymentId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({ error: 'Payment ID is required' });
    }

    // Find the payment
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Only allow removal of manual payments (check payments) for safety
    if (payment.paymentMethod !== 'check') {
      return res.status(400).json({ error: 'Only check payments can be removed' });
    }

    // Remove the payment
    await Payment.findByIdAndDelete(paymentId);

    // Update the associated application
    if (payment.applicationId) {
      const application = await Application.findById(payment.applicationId);
      if (application) {
        application.lastUpdated = new Date();
        await application.save();
      }
    }

    res.json({ success: true, message: 'Payment removed successfully' });
  } catch (error) {
    console.error('Error removing payment:', error);
    res.status(500).json({ error: 'Server error removing payment' });
  }
});

module.exports = { router, webhookRouter };
