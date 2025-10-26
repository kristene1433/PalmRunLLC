const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  applicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application',
    required: false // Made optional to handle existing payments without applicationId
  },
  
  // Stripe payment information
  stripePaymentIntentId: {
    type: String,
    required: true,
    unique: true
  },
  
  stripeCustomerId: {
    type: String,
    required: true
  },
  
  // Payment details
  amount: {
    type: Number,
    required: true
    // Removed min: 0 to allow negative amounts for transfers
  },
  
  // Credit card processing fee
  creditCardFee: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Total amount including fees
  totalAmount: {
    type: Number,
    required: true
    // Removed min: 0 to allow negative amounts for transfers
  },
  
  currency: {
    type: String,
    default: 'usd'
  },
  
  paymentType: {
    type: String,
    enum: ['deposit', 'rent', 'late_fee', 'deposit_transfer', 'admin_transfer', 'refund', 'other'],
    required: true
  },
  
  description: {
    type: String,
    required: true
  },
  
  // Payment status
  status: {
    type: String,
    enum: ['pending', 'processing', 'succeeded', 'failed', 'canceled'],
    default: 'pending'
  },
  
  // Payment method
  paymentMethod: {
    type: String,
    enum: ['card', 'bank_transfer', 'cash', 'check'],
    default: 'card'
  },
  
  // Card information (last 4 digits only for security)
  cardLast4: String,
  cardBrand: String,
  
  // Application fee (Stripe fee)
  applicationFee: Number,
  
  // Receipt information
  receiptUrl: String,
  
  // Metadata for additional information
  metadata: {
    propertyAddress: String,
    leaseStartDate: Date,
    leaseEndDate: Date,
    notes: String
  },
  
  // Error information if payment fails
  error: {
    code: String,
    message: String,
    declineCode: String
  },
  
  // Timestamps
  paidAt: Date,
  failedAt: Date,
  
  // Refund information
  refunded: {
    type: Boolean,
    default: false
  },
  
  refundAmount: Number,
  refundReason: String,
  refundedAt: Date,
  refundCategory: {
    type: String,
    enum: ['deposit', 'rent', 'other'],
    default: undefined
  },
  originalPaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  // Deposit transfer information
  isDepositTransfer: {
    type: Boolean,
    default: false
  },
  
  transferredFromApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application'
  },
  
  transferredToApplicationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application'
  },
  
  originalDepositAmount: Number, // Amount of the original deposit being transferred
  transferNotes: String
}, {
  timestamps: true
});

// Indexes for efficient queries
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ applicationId: 1, status: 1 });
paymentSchema.index({ status: 1, paidAt: 1 }); // For revenue calculations
paymentSchema.index({ paymentType: 1, status: 1 }); // For revenue by type
paymentSchema.index({ paidAt: 1, status: 1 }); // For monthly/yearly reports
paymentSchema.index({ stripePaymentIntentId: 1 }); // Unique index for webhook processing
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ isDepositTransfer: 1 });
paymentSchema.index({ transferredFromApplicationId: 1 });
paymentSchema.index({ transferredToApplicationId: 1 });

// Virtual for formatted amount
paymentSchema.virtual('formattedAmount').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: this.currency.toUpperCase()
  }).format(this.amount / 100); // Stripe amounts are in cents
});

// Virtual for payment status color
paymentSchema.virtual('statusColor').get(function() {
  const statusColors = {
    pending: 'warning',
    processing: 'info',
    succeeded: 'success',
    failed: 'danger',
    canceled: 'secondary'
  };
  return statusColors[this.status] || 'secondary';
});

// Method to check if payment is successful
paymentSchema.methods.isSuccessful = function() {
  return this.status === 'succeeded';
};

// Method to check if payment is pending
paymentSchema.methods.isPending = function() {
  return ['pending', 'processing'].includes(this.status);
};

// Method to check if payment failed
paymentSchema.methods.isFailed = function() {
  return ['failed', 'canceled'].includes(this.status);
};

// Ensure virtuals are serialized
paymentSchema.set('toJSON', { virtuals: true });
paymentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Payment', paymentSchema);
