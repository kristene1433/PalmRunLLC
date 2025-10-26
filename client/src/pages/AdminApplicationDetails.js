import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AdminNavbar from '../components/AdminNavbar';
import {
  ArrowLeft, Edit3, Save, X, RefreshCw, CheckCircle, XCircle,
  Calendar, FileText, Upload, Download, Trash2, Plus, CreditCard,
  User, AlertCircle, ArrowRightLeft
} from 'lucide-react';
import toast from 'react-hot-toast';

const AdminApplicationDetails = () => {
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploadingLease, setUploadingLease] = useState(false);
  const [leaseFile, setLeaseFile] = useState(null);
  const [showManualPaymentModal, setShowManualPaymentModal] = useState(false);
  const [manualPaymentData, setManualPaymentData] = useState({
    amount: '',
    paymentType: 'rent',
    paymentDate: new Date().toISOString().split('T')[0],
    checkNumber: '',
    notes: ''
  });
  const [savingManualPayment, setSavingManualPayment] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferData, setTransferData] = useState({
    toApplicationId: '',
    amount: '',
    notes: ''
  });
  const [availableApplications, setAvailableApplications] = useState([]);
  const [loadingApplications, setLoadingApplications] = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [showLeaseModal, setShowLeaseModal] = useState(false);
  const [generatingLease, setGeneratingLease] = useState(false);
  const [leaseFormData, setLeaseFormData] = useState({
    leaseStartDate: '',
    leaseEndDate: '',
    rentalAmount: '',
    depositAmount: ''
  });

  const formatDateForInput = (value) => {
    if (!value) {
      return new Date().toISOString().split('T')[0];
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) {
      return new Date().toISOString().split('T')[0];
    }
    return date.toISOString().split('T')[0];
  };

  const addMonths = (value, months = 12) => {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (isNaN(date.getTime())) {
      return new Date();
    }
    date.setMonth(date.getMonth() + months);
    return date;
  };

  const initializeLeaseForm = useCallback(() => {
    const today = new Date();
    const startSource = application?.leaseStartDate || application?.requestedStartDate || today;
    const endSource = application?.leaseEndDate || application?.requestedEndDate || addMonths(startSource, 12);

    setLeaseFormData({
      leaseStartDate: formatDateForInput(startSource),
      leaseEndDate: formatDateForInput(endSource),
      rentalAmount: application?.rentalAmount != null ? String(application.rentalAmount) : '',
      depositAmount: application?.depositAmount != null ? String(application.depositAmount) : '500'
    });
  }, [application]);

  const fetchApplicationData = useCallback(async () => {
    try {
      setLoading(true);
      
      // First fetch the application to get the userId
      const applicationRes = await fetch(`/api/application/admin/${id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });

      if (applicationRes.ok) {
        const data = await applicationRes.json();
        setApplication(data.application);
        
        // Now fetch payments using the application's userId
        if (data.application?.userId) {
          // Extract the actual userId string (in case it's populated)
          const userId = typeof data.application.userId === 'string' 
            ? data.application.userId 
            : data.application.userId._id || data.application.userId.id;
            
          const paymentsRes = await fetch(`/api/payment/admin/history/${userId}?applicationId=${id}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          
          if (paymentsRes.ok) {
            const paymentsData = await paymentsRes.json();
            setPayments(paymentsData.payments || []);
          }
        }
      } else {
        toast.error('Application not found');
        navigate('/admin/dashboard');
        return;
      }
    } catch (error) {
      console.error('Error loading application data:', error);
      toast.error('Failed to load application data');
      navigate('/admin/dashboard');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchApplicationData();
  }, [fetchApplicationData]);

  useEffect(() => {
    if (application) {
      initializeLeaseForm();
    }
  }, [application, initializeLeaseForm]);

  // Check if user is authenticated and is admin
  if (!user || user.role !== 'admin') {
    navigate('/admin/login');
    return null;
  }

  const updateApplicationStatus = async (newStatus) => {
    try {
      const response = await fetch(`/api/application/admin/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        toast.success('Application status updated');
        setApplication(prev => ({ ...prev, status: newStatus }));
        if (newStatus === 'approved' && !application?.leaseGenerated) {
          initializeLeaseForm();
          setShowLeaseModal(true);
        }
      } else {
        toast.error('Failed to update status');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Error updating status');
    }
  };

  const handleEdit = () => {
    if (application) {
      setEditData({
        firstName: application.firstName || '',
        lastName: application.lastName || '',
        email: application.userId?.email || '',
        secondApplicantFirstName: application.secondApplicantFirstName || '',
        secondApplicantLastName: application.secondApplicantLastName || '',
        phone: application.phone || '',
        address: {
          street: application.address?.street || '',
          city: application.address?.city || '',
          state: application.address?.state || '',
          zipCode: application.address?.zipCode || ''
        },
        requestedStartDate: application.requestedStartDate || '',
        requestedEndDate: application.requestedEndDate || '',
        rentalAmount: application.rentalAmount || '',
        depositAmount: application.depositAmount || '',
        additionalGuests: application.additionalGuests ? [...application.additionalGuests] : [],
        notes: application.notes || ''
      });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({});
  };

  const handleInputChange = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setEditData(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value
        }
      }));
    } else {
      setEditData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  // Guest management functions
  const addGuest = () => {
    setEditData(prev => ({
      ...prev,
      additionalGuests: [...(prev.additionalGuests || []), {
        firstName: '',
        lastName: '',
        isAdult: true
      }]
    }));
  };

  const removeGuest = (index) => {
    setEditData(prev => ({
      ...prev,
      additionalGuests: prev.additionalGuests.filter((_, i) => i !== index)
    }));
  };

  const updateGuest = (index, field, value) => {
    setEditData(prev => ({
      ...prev,
      additionalGuests: prev.additionalGuests.map((guest, i) => 
        i === index ? { ...guest, [field]: value } : guest
      )
    }));
  };

  // Transfer functionality
  const fetchAvailableApplications = async () => {
    if (!application?.userId?._id) return;
    
    try {
      setLoadingApplications(true);
      const response = await fetch(`/api/payment/admin/available-deposits?userId=${application.userId._id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Filter out the current application and only show applications with available balance
        const filtered = data.applications.filter(app => 
          app.applicationId._id !== id && app.totalBalance > 0
        );
        setAvailableApplications(filtered);
      } else {
        toast.error('Failed to fetch available applications');
      }
    } catch (error) {
      console.error('Error fetching applications:', error);
      toast.error('Error fetching applications');
    } finally {
      setLoadingApplications(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferData.toApplicationId || !transferData.amount) {
      toast.error('Please select destination application and enter amount');
      return;
    }

    try {
      setSavingTransfer(true);
      const response = await fetch('/api/payment/admin/transfer-amount', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          fromApplicationId: id,
          toApplicationId: transferData.toApplicationId,
          depositAmount: Math.round(parseFloat(transferData.amount) * 100), // Convert to cents
          transferNotes: transferData.notes
        })
      });

      if (response.ok) {
        toast.success('Transfer completed successfully!');
        setShowTransferModal(false);
        setTransferData({ toApplicationId: '', amount: '', notes: '' });
        await fetchApplicationData(); // Refresh data
      } else {
        const error = await response.json();
        toast.error(error.error || 'Transfer failed');
      }
    } catch (error) {
      console.error('Transfer error:', error);
      toast.error('Error processing transfer');
    } finally {
      setSavingTransfer(false);
    }
  };

  const openTransferModal = () => {
    setTransferData({ toApplicationId: '', amount: '', notes: '' });
    setShowTransferModal(true);
    fetchAvailableApplications();
  };

  const handleSaveEdit = async () => {
    try {
      setSaving(true);
      
      const response = await fetch(`/api/application/admin/${id}/edit`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(editData)
      });

      if (response.ok) {
        const updatedApplication = await response.json();
        setApplication(updatedApplication.application);
        setIsEditing(false);
        setEditData({});
        toast.success('Application updated successfully!');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to update application');
      }
    } catch (error) {
      console.error('Error updating application:', error);
      toast.error('Error updating application');
    } finally {
      setSaving(false);
    }
  };

  const handleLeaseUpload = async () => {
    if (!leaseFile) {
      toast.error('Please select a file to upload');
      return;
    }

    try {
      setUploadingLease(true);
      
      const formData = new FormData();
      formData.append('leaseFile', leaseFile);
      formData.append('applicationId', id);

      const response = await fetch('/api/application/admin/upload-lease', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      if (response.ok) {
        await response.json();
        toast.success('Signed lease uploaded successfully!');
        await fetchApplicationData();
        setLeaseFile(null);
        const fileInput = document.getElementById('lease-upload-input');
        if (fileInput) fileInput.value = '';
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to upload signed lease');
      }
    } catch (error) {
      console.error('Error uploading signed lease:', error);
      toast.error('Error uploading signed lease');
    } finally {
      setUploadingLease(false);
    }
  };

  const handleGenerateLease = async (event) => {
    if (event) {
      event.preventDefault();
    }

    if (!leaseFormData.leaseStartDate || !leaseFormData.leaseEndDate || !leaseFormData.rentalAmount || !leaseFormData.depositAmount) {
      toast.error('Please complete all lease fields');
      return;
    }

    try {
      setGeneratingLease(true);
      const response = await fetch('/api/lease/admin/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          applicationId: id,
          leaseStartDate: leaseFormData.leaseStartDate,
          leaseEndDate: leaseFormData.leaseEndDate,
          rentalAmount: Number(leaseFormData.rentalAmount),
          depositAmount: Number(leaseFormData.depositAmount)
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to generate lease');
      }

      toast.success('Lease agreement generated!');
      setShowLeaseModal(false);
      await fetchApplicationData();
    } catch (error) {
      console.error('Error generating lease:', error);
      toast.error(error.message || 'Error generating lease');
    } finally {
      setGeneratingLease(false);
    }
  };

  const handleViewLease = async () => {
    console.log('View lease clicked:', { 
      applicationId: id, 
      leaseSigned: application?.leaseSigned,
      hasSignedLeaseFile: !!application?.signedLeaseFile 
    });
    
    if (application?.leaseSigned) {
      try {
        const token = localStorage.getItem('token');
        console.log('Fetching lease with token:', token ? 'present' : 'missing');
        
        const response = await fetch(`/api/lease/view-signed/${id}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        console.log('Lease fetch response:', { 
          ok: response.ok, 
          status: response.status, 
          statusText: response.statusText 
        });

        if (response.ok) {
          const blob = await response.blob();
          console.log('Lease blob created:', { size: blob.size, type: blob.type });
          const url = window.URL.createObjectURL(blob);
          window.open(url, '_blank');
        } else {
          const errorText = await response.text();
          console.error('Lease fetch error:', errorText);
          toast.error('Failed to load lease document');
        }
      } catch (error) {
        console.error('Error viewing lease:', error);
        toast.error('Error loading lease document');
      }
    } else {
      toast.error('No signed lease available to view');
    }
  };

  const handleDeleteLease = async () => {
    if (!window.confirm('Are you sure you want to delete this lease? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/application/admin/remove-lease/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        toast.success('Lease deleted successfully!');
        await fetchApplicationData();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to delete lease');
      }
    } catch (error) {
      console.error('Error deleting lease:', error);
      toast.error('Error deleting lease');
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (!window.confirm('Are you sure you want to delete this payment? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/payment/admin/remove/${paymentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        toast.success('Payment deleted successfully!');
        await fetchApplicationData();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to delete payment');
      }
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('Error deleting payment');
    }
  };

  const handleManualPayment = async () => {
    if (!manualPaymentData.amount || !manualPaymentData.paymentType) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setSavingManualPayment(true);
      
      const response = await fetch('/api/payment/admin/manual-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...manualPaymentData,
          applicationId: id,
          amount: parseFloat(manualPaymentData.amount) // Backend will convert to cents
        })
      });

      if (response.ok) {
        toast.success('Manual payment added successfully!');
        setShowManualPaymentModal(false);
        setManualPaymentData({
          amount: '',
          paymentType: 'rent',
          paymentDate: new Date().toISOString().split('T')[0],
          checkNumber: '',
          notes: ''
        });
        await fetchApplicationData();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to add manual payment');
      }
    } catch (error) {
      console.error('Error adding manual payment:', error);
      toast.error('Error adding manual payment');
    } finally {
      setSavingManualPayment(false);
    }
  };

  const deleteApplication = async () => {
    if (!window.confirm('Are you sure you want to delete this application? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/application/admin/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        toast.success('Application deleted successfully');
        navigate('/admin/dashboard');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to delete application');
      }
    } catch (error) {
      console.error('Error deleting application:', error);
      toast.error('Error deleting application');
    }
  };

  const formatDate = (value) => {
    if (!value) return 'Not set';

    // If it's already a Date instance
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return 'Invalid Date';
      return value.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // For YYYY-MM-DD strings, parse manually to avoid timezone issues
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      const date = new Date(year, month - 1, day); // month is 0-indexed
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // Fallback for other date formats
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount / 100);
  };

  // Format phone number with dashes
  const formatPhoneNumber = (phone) => {
    if (!phone) return 'Not provided';
    
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Format as XXX-XXX-XXXX for 10-digit numbers
    if (cleaned.length === 10) {
      return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    }
    
    // Format as +X-XXX-XXX-XXXX for 11-digit numbers starting with 1
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return cleaned.replace(/(\d{1})(\d{3})(\d{3})(\d{4})/, '+$1-$2-$3-$4');
    }
    
    // Return original if it doesn't match expected formats
    return phone;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved':
        return 'text-green-600 bg-green-100';
      case 'pending':
        return 'text-blue-600 bg-blue-100';
      case 'rejected':
        return 'text-red-600 bg-red-100';
      case 'completed':
        return 'text-blue-600 bg-blue-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const calculatePaymentTotals = () => {
    if (!application || !payments) return { totalOwed: 0, totalPaid: 0, balance: 0 };

    let totalOwed = 0;
    if (application.leaseGenerated) {
      const depositAmount = application.depositAmount || 0;
      const rentalAmount = application.rentalAmount || 0;
      totalOwed = depositAmount + rentalAmount;
    }

    const totalPaid = payments
      .filter(payment => payment.status === 'succeeded')
      .reduce((sum, payment) => sum + payment.amount, 0);

    const balance = totalOwed - (totalPaid / 100);

    return {
      totalOwed: totalOwed,
      totalPaid: totalPaid / 100,
      balance: balance
    };
  };

  const paymentTotals = calculatePaymentTotals();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Application not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <AdminNavbar />
      {/* Header */}
      <div className="bg-white shadow-sm border-b backdrop-blur-sm bg-white/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => navigate('/admin/dashboard')}
                  className="flex items-center text-gray-600 hover:text-gray-900 transition-colors duration-200 group"
                >
                  <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform duration-200" />
                  Back to Dashboard
                </button>
                <div className="h-6 w-px bg-gray-300"></div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Application Details</h1>
                  <p className="text-sm text-gray-600">
                    {application.firstName} {application.lastName} • <span className="font-medium capitalize text-blue-600">{application.status}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={fetchApplicationData}
                  className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </button>
                <button
                  onClick={deleteApplication}
                  className="flex items-center px-3 py-2 text-sm text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fadeIn">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column - Main Information */}
          <div className="xl:col-span-2 space-y-6">
            {/* Personal Information */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow duration-300">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <User className="h-5 w-5 mr-2 text-blue-600" />
                  Personal Information
                </h3>
                {!isEditing ? (
                  <button
                    onClick={handleEdit}
                    className="flex items-center px-3 py-2 text-sm text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
                  >
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit
                  </button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="flex items-center px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className="flex items-center px-3 py-2 text-sm text-gray-600 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Main Applicant */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900 border-b border-gray-200 pb-2">Main Applicant</h4>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Name</label>
                    {isEditing ? (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <input
                          type="text"
                          value={editData.firstName || ''}
                          onChange={(e) => handleInputChange('firstName', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="First Name"
                        />
                        <input
                          type="text"
                          value={editData.lastName || ''}
                          onChange={(e) => handleInputChange('lastName', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Last Name"
                        />
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-gray-900 mt-1">
                        {application.firstName} {application.lastName}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</label>
                    {isEditing ? (
                      <input
                        type="email"
                        value={editData.email || ''}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-1"
                        placeholder="Email address"
                      />
                    ) : (
                      <p className="text-sm font-medium text-gray-900 mt-1">{application.userId?.email || 'N/A'}</p>
                    )}
                  </div>
                </div>

                {/* Co-Applicant */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900 border-b border-gray-200 pb-2">Co-Applicant</h4>
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Name</label>
                    {isEditing ? (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <input
                          type="text"
                          value={editData.secondApplicantFirstName || ''}
                          onChange={(e) => handleInputChange('secondApplicantFirstName', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="First Name"
                        />
                        <input
                          type="text"
                          value={editData.secondApplicantLastName || ''}
                          onChange={(e) => handleInputChange('secondApplicantLastName', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Last Name"
                        />
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-gray-900 mt-1">
                        {application.secondApplicantFirstName && application.secondApplicantLastName
                          ? `${application.secondApplicantFirstName} ${application.secondApplicantLastName}`
                          : 'Not provided'
                        }
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Additional fields in a separate row */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">

                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Phone</label>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editData.phone || ''}
                      onChange={(e) => handleInputChange('phone', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-1"
                      placeholder="Phone Number"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 mt-1">{formatPhoneNumber(application.phone)}</p>
                  )}
                </div>

                <div className="lg:col-span-2">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Address</label>
                  {isEditing ? (
                    <div className="space-y-2 mt-1">
                      <input
                        type="text"
                        value={editData.address?.street || ''}
                        onChange={(e) => handleInputChange('address.street', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Street Address"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={editData.address?.city || ''}
                          onChange={(e) => handleInputChange('address.city', e.target.value)}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="City"
                        />
                        <input
                          type="text"
                          value={editData.address?.state || ''}
                          onChange={(e) => handleInputChange('address.state', e.target.value)}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="State"
                        />
                        <input
                          type="text"
                          value={editData.address?.zipCode || ''}
                          onChange={(e) => handleInputChange('address.zipCode', e.target.value)}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="ZIP Code"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {application.address?.street}, {application.address?.city}, {application.address?.state} {application.address?.zipCode}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Requested Dates</label>
                  {isEditing ? (
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <input
                        type="date"
                        value={editData.requestedStartDate || ''}
                        onChange={(e) => handleInputChange('requestedStartDate', e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Start Date"
                      />
                      <input
                        type="date"
                        value={editData.requestedEndDate || ''}
                        onChange={(e) => handleInputChange('requestedEndDate', e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="End Date"
                      />
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {application.requestedStartDate && application.requestedEndDate 
                        ? `${formatDate(application.requestedStartDate)} - ${formatDate(application.requestedEndDate)}`
                        : 'Not specified'
                      }
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monthly Rent</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editData.rentalAmount || ''}
                      onChange={(e) => handleInputChange('rentalAmount', parseFloat(e.target.value) || '')}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-1"
                      placeholder="0.00"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {application.rentalAmount ? formatCurrency(application.rentalAmount * 100) : 'Not set'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Guests</label>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {(() => {
                      let totalGuests = 1; // Main applicant
                      if (application.secondApplicantFirstName || application.secondApplicantLastName) {
                        totalGuests += 1; // Second applicant
                      }
                      totalGuests += application.additionalGuests?.length || 0; // Additional guests
                      return totalGuests;
                    })()} guest{(() => {
                      let totalGuests = 1; // Main applicant
                      if (application.secondApplicantFirstName || application.secondApplicantLastName) {
                        totalGuests += 1; // Second applicant
                      }
                      totalGuests += application.additionalGuests?.length || 0; // Additional guests
                      return totalGuests !== 1 ? 's' : '';
                    })()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    (1 main applicant{application.secondApplicantFirstName || application.secondApplicantLastName ? ' + 1 co-applicant' : ''}{application.additionalGuests?.length ? ` + ${application.additionalGuests.length} additional` : ''})
                  </p>
                </div>
              </div>

              {isEditing && (
                <div className="mt-4">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Admin Notes</label>
                  <textarea
                    value={editData.notes || ''}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-1"
                    rows={3}
                    placeholder="Add admin notes..."
                  />
                </div>
              )}

              {!isEditing && application.notes && (
                <div className="mt-4">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Admin Notes</label>
                  <p className="text-sm text-gray-900 mt-1 bg-blue-50 p-3 rounded-lg border border-blue-200">
                    {application.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Additional Guests Section */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow duration-300">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2 text-blue-600" />
                Additional Guests
              </h3>


              {/* Additional Guests Section */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-900">
                    Additional Guests ({(isEditing ? editData.additionalGuests : application.additionalGuests)?.length || 0})
                  </h4>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={addGuest}
                      className="flex items-center px-3 py-1 text-sm text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Guest
                    </button>
                  )}
                </div>

                {(isEditing ? editData.additionalGuests : application.additionalGuests) && (isEditing ? editData.additionalGuests : application.additionalGuests).length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(isEditing ? editData.additionalGuests : application.additionalGuests).map((guest, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h5 className="text-sm font-medium text-gray-900">Guest {index + 1}</h5>
                          <div className="flex items-center space-x-2">
                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => removeGuest(index)}
                                className="text-red-600 hover:text-red-800"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              guest.isAdult ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {guest.isAdult ? 'Adult (18+)' : 'Minor'}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">First Name</label>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={guest.firstName}
                                  onChange={(e) => updateGuest(index, 'firstName', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 mt-1"
                                  placeholder="First Name"
                                />
                              ) : (
                                <p className="text-sm font-medium text-gray-900 mt-1">{guest.firstName}</p>
                              )}
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Last Name</label>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={guest.lastName}
                                  onChange={(e) => updateGuest(index, 'lastName', e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 mt-1"
                                  placeholder="Last Name"
                                />
                              ) : (
                                <p className="text-sm font-medium text-gray-900 mt-1">{guest.lastName}</p>
                              )}
                            </div>
                          </div>
                          {isEditing && (
                            <div>
                              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Age Category</label>
                              <select
                                value={guest.isAdult ? 'adult' : 'minor'}
                                onChange={(e) => updateGuest(index, 'isAdult', e.target.value === 'adult')}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500 mt-1"
                              >
                                <option value="adult">Adult (18+)</option>
                                <option value="minor">Minor</option>
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <p className="text-sm text-gray-500">No additional guests provided</p>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Information */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow duration-300">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <CreditCard className="h-5 w-5 mr-2 text-blue-600" />
                Payment Information
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h5 className="text-sm font-medium text-blue-900">Total Owed</h5>
                  <p className="text-lg font-bold text-blue-900">
                    {formatCurrency(paymentTotals.totalOwed * 100)}
                  </p>
                  <p className="text-xs text-blue-700">
                    {application?.leaseGenerated 
                      ? `$${application?.depositAmount || 0} deposit + $${application?.rentalAmount || 0} rent`
                      : 'Amounts will be set when lease is created'
                    }
                  </p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
                  <h5 className="text-sm font-medium text-green-900">Total Paid</h5>
                  <p className="text-lg font-bold text-green-900">
                    {formatCurrency(paymentTotals.totalPaid * 100)}
                  </p>
                  <p className="text-xs text-green-700">
                    {payments.filter(payment => payment.status === 'succeeded').length} successful payments
                  </p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h5 className="text-sm font-medium text-gray-700">Balance</h5>
                  <p className={`text-lg font-bold ${paymentTotals.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(paymentTotals.balance * 100)}
                  </p>
                  <p className="text-xs text-gray-600">
                    {paymentTotals.balance > 0 ? 'Amount owed' : 'Overpaid'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <h4 className="text-base font-medium text-gray-900">Recent Payments</h4>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={openTransferModal}
                    className="flex items-center px-3 py-2 text-sm text-green-600 hover:text-green-700 border border-green-200 rounded-lg hover:bg-green-50"
                  >
                    <ArrowRightLeft className="w-4 h-4 mr-2" />
                    Transfer
                  </button>
                  <button
                    onClick={() => setShowManualPaymentModal(true)}
                    className="flex items-center px-3 py-2 text-sm text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Payment
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {payments.slice(0, 5).map((payment) => (
                  <div key={payment._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center space-x-3">
                      <div className={`w-2 h-2 rounded-full ${payment.status === 'succeeded' ? 'bg-green-500' : payment.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {payment.description}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDate(payment.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatCurrency(payment.amount)}
                        </p>
                        <p className={`text-xs px-2 py-1 rounded-full ${getStatusColor(payment.status)}`}>
                          {payment.status}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeletePayment(payment._id)}
                        className="flex items-center p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete payment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Status and Actions */}
          <div className="space-y-6">
            {/* Application Status */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow duration-300">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <CheckCircle className="h-5 w-5 mr-2 text-blue-600" />
                Application Status
              </h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Status:</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(application.status)}`}>
                    {application.status?.charAt(0).toUpperCase() + application.status?.slice(1)}
                  </span>
                </div>

                <div className="flex items-center space-x-3">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Submitted</p>
                    <p className="text-sm font-medium text-gray-900">{formatDate(application.submittedAt)}</p>
                  </div>
                </div>

                {application.leaseSigned && (
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lease Uploaded</p>
                      <p className="text-sm font-medium text-gray-900">{formatDate(application.leaseSignedAt)}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Update Status:</h4>
                <div className="space-y-2">
                  <button
                    onClick={() => updateApplicationStatus('approved')}
                    className="w-full flex items-center justify-center px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve
                  </button>
                  <button
                    onClick={() => updateApplicationStatus('rejected')}
                    className="w-full flex items-center justify-center px-3 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Decline
                  </button>
                  <button
                    onClick={() => updateApplicationStatus('completed')}
                    className="w-full flex items-center justify-center px-3 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete
                  </button>
                </div>
              </div>
            </div>

            {/* Lease Information - Side by Side Layout */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 hover:shadow-xl transition-shadow duration-300">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <FileText className="h-5 w-5 mr-2 text-blue-600" />
                Lease Information
              </h3>

              {application.leaseGenerated ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Start Date</label>
                      <p className="text-sm font-medium text-gray-900 mt-1">{formatDate(application.leaseStartDate)}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">End Date</label>
                      <p className="text-sm font-medium text-gray-900 mt-1">{formatDate(application.leaseEndDate)}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monthly Rent</label>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editData.rentalAmount || ''}
                          onChange={(e) => handleInputChange('rentalAmount', parseFloat(e.target.value) || '')}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-1"
                          placeholder="0.00"
                        />
                      ) : (
                        <p className="text-sm font-medium text-gray-900 mt-1">{formatCurrency(application.rentalAmount * 100)}</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Security Deposit</label>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editData.depositAmount || ''}
                          onChange={(e) => handleInputChange('depositAmount', parseFloat(e.target.value) || '')}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-1"
                          placeholder="0.00"
                        />
                      ) : (
                        <p className="text-sm font-medium text-gray-900 mt-1">{formatCurrency(application.depositAmount * 100)}</p>
                      )}
                    </div>
                  </div>

                  {/* Side by Side Lease Status Sections */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Admin Upload Physical Lease */}
                    <div className={`border rounded-lg p-4 ${application.leaseSigned && application.signedLeaseFile?.uploadedBy === 'admin' ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                      <h4 className={`text-sm font-medium mb-2 ${application.leaseSigned && application.signedLeaseFile?.uploadedBy === 'admin' ? 'text-green-900' : 'text-gray-900'}`}>
                        Admin Upload Physical Lease
                      </h4>
                      <p className="text-xs text-gray-600 mb-3">Upload the physically signed agreement that was mailed by the tenant.</p>
                      
                      {application.leaseSigned && application.signedLeaseFile?.uploadedBy === 'admin' ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h5 className="text-xs font-medium text-green-900">
                              {application.signedLeaseFile?.uploadedBy === 'admin' ? 'Physical Lease Uploaded!' : 'Lease Available!'}
                            </h5>
                            <button
                              onClick={handleDeleteLease}
                              className="flex items-center p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              title="Delete lease"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs text-green-700">
                            {application.signedLeaseFile?.originalName 
                              ? `File: ${application.signedLeaseFile.originalName}`
                              : `File: lease_${application._id}.pdf`
                            }
                          </p>
                          <p className="text-xs text-green-600">
                            {application.signedLeaseFile?.uploadedBy === 'admin' ? 'Uploaded:' : 'Available:'} {formatDate(application.leaseSignedAt)}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <input
                            id="lease-upload-input"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => setLeaseFile(e.target.files[0])}
                            className="block w-full text-xs text-gray-500 file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-2"
                          />
                          <p className="text-xs text-gray-500">PDF, JPEG, PNG (max 10MB)</p>
                          <button
                            onClick={handleLeaseUpload}
                            disabled={!leaseFile || uploadingLease}
                            className="w-full flex items-center justify-center px-3 py-2 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                          >
                            <Upload className="w-3 h-3 mr-1" />
                            {uploadingLease ? 'Uploading...' : 'Upload Physical Lease'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* User Signed Lease */}
                    <div className={`border rounded-lg p-4 ${application.leaseSigned && (application.signedLeaseFile?.uploadedBy === 'user' || !application.signedLeaseFile?.uploadedBy) ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
                      <h4 className={`text-sm font-medium mb-2 ${application.leaseSigned && (application.signedLeaseFile?.uploadedBy === 'user' || !application.signedLeaseFile?.uploadedBy) ? 'text-green-900' : 'text-gray-900'}`}>
                        User Signed Lease
                      </h4>
                      <p className="text-xs text-gray-600 mb-3">Lease signed by tenant through their account.</p>
                      
                      {application.leaseSigned && (application.signedLeaseFile?.uploadedBy === 'user' || !application.signedLeaseFile?.uploadedBy) ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h5 className="text-xs font-medium text-green-900">
                              {application.signedLeaseFile?.uploadedBy === 'user' ? 'Lease Signed by User!' : 'Lease Available!'}
                            </h5>
                            <button
                              onClick={handleDeleteLease}
                              className="flex items-center p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              title="Delete lease"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs text-green-700">
                            {application.signedLeaseFile?.originalName 
                              ? `File: ${application.signedLeaseFile.originalName}`
                              : `File: lease_${application._id}.pdf`
                            }
                          </p>
                          <p className="text-xs text-green-600">
                            {application.signedLeaseFile?.uploadedBy === 'user' ? 'Signed:' : 'Available:'} {formatDate(application.leaseSignedAt)}
                          </p>
                        </div>
                      ) : (
                        <div className="text-center py-4">
                          <AlertCircle className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                          <p className="text-xs text-gray-500">No lease signed by user yet</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Lease Management Actions */}
                  {application.leaseSigned && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">Lease Management</h4>
                      <div className="flex gap-3">
                        <button 
                          onClick={handleViewLease}
                          className="flex items-center px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          View Lease
                        </button>
                        <button 
                          onClick={handleViewLease}
                          className="flex items-center px-4 py-2 text-sm text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download Lease
                        </button>
                        <button 
                          onClick={handleDeleteLease}
                          className="flex items-center px-4 py-2 text-sm text-red-700 bg-red-100 hover:bg-red-200 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Lease
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="text-center py-6">
                  <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    Lease not yet generated. Generate lease agreement to set terms and amounts.
                  </p>
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => {
                        initializeLeaseForm();
                        setShowLeaseModal(true);
                      }}
                      disabled={application.status !== 'approved' || generatingLease}
                      className={`inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                        application.status === 'approved'
                          ? 'text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                          : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                      }`}
                    >
                      {generatingLease ? 'Preparing...' : 'Generate Lease Agreement'}
                    </button>
                    {application.status !== 'approved' && (
                      <p className="text-xs text-gray-500">
                        Approve the application to unlock the lease generator.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Generate Lease Modal */}
      {showLeaseModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-6 border w-full max-w-lg shadow-lg rounded-md bg-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Generate Lease Agreement</h3>
              <button
                onClick={() => setShowLeaseModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleGenerateLease}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lease Start Date
                  </label>
                  <input
                    type="date"
                    value={leaseFormData.leaseStartDate}
                    onChange={(e) => setLeaseFormData(prev => ({ ...prev, leaseStartDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lease End Date
                  </label>
                  <input
                    type="date"
                    value={leaseFormData.leaseEndDate}
                    onChange={(e) => setLeaseFormData(prev => ({ ...prev, leaseEndDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Monthly Rent ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={leaseFormData.rentalAmount}
                    onChange={(e) => setLeaseFormData(prev => ({ ...prev, rentalAmount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Security Deposit ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={leaseFormData.depositAmount}
                    onChange={(e) => setLeaseFormData(prev => ({ ...prev, depositAmount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-xs text-blue-700">
                Lease details will be saved to the application and shared with the tenant immediately after generation.
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLeaseModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generatingLease}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingLease ? 'Generating...' : 'Generate Lease'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Payment Modal */}
      {showManualPaymentModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Add Manual Payment</h3>
                <button
                  onClick={() => setShowManualPaymentModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualPaymentData.amount}
                    onChange={(e) => setManualPaymentData(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Type</label>
                  <select
                    value={manualPaymentData.paymentType}
                    onChange={(e) => setManualPaymentData(prev => ({ ...prev, paymentType: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="rent">Rent</option>
                    <option value="deposit">Deposit</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={manualPaymentData.paymentDate}
                    onChange={(e) => setManualPaymentData(prev => ({ ...prev, paymentDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Check Number (Optional)</label>
                  <input
                    type="text"
                    value={manualPaymentData.checkNumber}
                    onChange={(e) => setManualPaymentData(prev => ({ ...prev, checkNumber: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Check number"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                  <textarea
                    value={manualPaymentData.notes}
                    onChange={(e) => setManualPaymentData(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    rows={3}
                    placeholder="Payment notes..."
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowManualPaymentModal(false)}
                  className="px-4 py-2 text-sm text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleManualPayment}
                  disabled={savingManualPayment}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {savingManualPayment ? 'Adding...' : 'Add Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Transfer Amount</h3>
                <button
                  onClick={() => setShowTransferModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    From Application
                  </label>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-sm font-medium text-gray-900">
                      {application?.firstName} {application?.lastName}
                    </p>
                    <p className="text-xs text-gray-500">
                      Application #{application?.applicationNumber || 'N/A'}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    To Application
                  </label>
                  {loadingApplications ? (
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-center">
                      <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Loading applications...</p>
                    </div>
                  ) : (
                    <select
                      value={transferData.toApplicationId}
                      onChange={(e) => setTransferData(prev => ({ ...prev, toApplicationId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    >
                      <option value="">Select destination application</option>
                      {availableApplications.map((app) => (
                        <option key={app.applicationId._id} value={app.applicationId._id}>
                          {app.applicationId.firstName} {app.applicationId.lastName} - 
                          App #{app.applicationId.applicationNumber} 
                          (${(app.totalBalance / 100).toFixed(2)} available)
                        </option>
                      ))}
                    </select>
                  )}
                  {availableApplications.length === 0 && !loadingApplications && (
                    <p className="text-sm text-gray-500 mt-1">No other applications with available balance found</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Transfer Amount ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={transferData.amount}
                    onChange={(e) => setTransferData(prev => ({ ...prev, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Transfer Notes (Optional)
                  </label>
                  <textarea
                    value={transferData.notes}
                    onChange={(e) => setTransferData(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    rows="3"
                    placeholder="e.g., Annual lease renewal deposit transfer"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    onClick={() => setShowTransferModal(false)}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTransfer}
                    disabled={savingTransfer || !transferData.toApplicationId || !transferData.amount}
                    className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingTransfer ? 'Transferring...' : 'Transfer Amount'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminApplicationDetails;
