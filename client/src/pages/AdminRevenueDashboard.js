import React, { useState, useEffect, useCallback } from 'react';
import AdminNavbar from '../components/AdminNavbar';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Calendar,
  BarChart3,
  PieChart,
  Download,
  Filter
} from 'lucide-react';

const AdminRevenueDashboard = () => {
  const [revenueData, setRevenueData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedBasis, setSelectedBasis] = useState('accrual');

  const fetchRevenueData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let url = '/api/payment/admin/revenue-summary';
      const params = new URLSearchParams();

      if (selectedPeriod === 'year') {
        params.append('period', 'year');
        params.append('year', selectedYear);
      } else if (selectedPeriod === 'month') {
        params.append('period', 'month');
        params.append('year', selectedYear);
        params.append('month', selectedMonth);
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch revenue data');
      }

      const data = await response.json();
      setRevenueData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, selectedYear, selectedMonth]);

  useEffect(() => {
    fetchRevenueData();
  }, [fetchRevenueData]);

  const formatCurrency = (amount = 0) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount / 100);
  };

  const formatPercentage = (value, total) => {
    if (!total) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const formatMonthLabel = (monthKey) => {
    if (!monthKey) return 'N/A';
    const [year, month] = monthKey.split('-').map(Number);
    if (!year || !month) return monthKey;
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const formatNumber = (value = 0) => Number(value || 0).toLocaleString('en-US');

  const handleExportCsv = () => {
    if (!revenueData) return;

    const cashByMonth = revenueData.monthlyRevenue || {};
    const accrualTimeline = revenueData.accrualTimeline || {};
    const occupancyTimeline = revenueData.occupancyTimeline || {};
    const months = Array.from(new Set([
      ...Object.keys(cashByMonth),
      ...Object.keys(accrualTimeline)
    ])).sort();

    const rows = [['Month', 'Cash Collected (USD)', 'Accrual Rent (USD)', 'Occupancy Nights']];
    months.forEach((monthKey) => {
      const cashAmount = cashByMonth[monthKey] || 0;
      const accrualAmount = accrualTimeline[monthKey] || 0;
      const nights = occupancyTimeline[monthKey] || 0;
      rows.push([
        formatMonthLabel(monthKey),
        (cashAmount / 100).toFixed(2),
        (accrualAmount / 100).toFixed(2),
        nights
      ]);
    });

    rows.push([]);
    rows.push([
      'Totals',
      ((revenueData.summary?.totalRevenue || 0) / 100).toFixed(2),
      ((revenueData.accrualSummary?.totalEarned || 0) / 100).toFixed(2),
      revenueData.accrualSummary?.occupiedNights || 0
    ]);
    rows.push([
      'Outstanding Deposits',
      ((revenueData.accrualSummary?.outstandingDeposits || 0) / 100).toFixed(2),
      '',
      ''
    ]);
    rows.push([
      'Released Deposits',
      ((revenueData.accrualSummary?.releasedDeposits || 0) / 100).toFixed(2),
      '',
      ''
    ]);
    rows.push([
      'Upcoming Revenue',
      ((revenueData.accrualSummary?.upcomingRevenue || 0) / 100).toFixed(2),
      '',
      ''
    ]);

    const csvContent = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `palm-run-revenue-${selectedPeriod}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const monthOptions = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
  ];

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <BarChart3 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Loading revenue data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <TrendingDown className="h-8 w-8 mx-auto mb-4 text-red-600" />
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchRevenueData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!revenueData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminNavbar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center text-gray-600">
          No revenue data available for the selected filters.
        </div>
      </div>
    );
  }

  const cashSummary = revenueData.summary || {};
  const accrualSummary = revenueData.accrualSummary || {};
  const cashMonthlyRevenue = revenueData.monthlyRevenue || {};
  const accrualMonthlyRevenue = revenueData.accrualMonthlyRevenue || {};
  const occupancyByMonth = revenueData.occupancyByMonth || {};
  const revenueByTypeEntries = Object.entries(revenueData.revenueByType || {});
  const totalRevenueByType = revenueByTypeEntries.reduce((sum, [, value]) => sum + (value.amount || 0), 0);

  const summaryCards = selectedBasis === 'cash'
    ? [
        {
          label: 'Cash Collected',
          value: formatCurrency(cashSummary.totalRevenue || 0),
          sublabel: `${cashSummary.paymentCount || 0} payments`,
          icon: DollarSign
        },
        {
          label: 'Net After Fees',
          value: formatCurrency(cashSummary.netRevenue || 0),
          sublabel: `Fees: ${formatCurrency(cashSummary.totalFees || 0)}`,
          icon: TrendingUp
        },
        {
          label: 'Refunds Issued',
          value: formatCurrency(cashSummary.refundsTotal || 0),
          sublabel: cashSummary.refundsTotal ? 'Manual refunds this period' : 'No refunds recorded',
          icon: TrendingDown
        },
        {
          label: 'Avg Payment',
          value: formatCurrency(cashSummary.averagePayment || 0),
          sublabel: cashSummary.paymentCount ? 'Cash basis view' : 'No payments yet',
          icon: PieChart
        }
      ]
    : [
        {
          label: 'Rent Earned',
          value: formatCurrency(accrualSummary.totalEarned || 0),
          sublabel: `${accrualSummary.monthsInPeriod || 0} month Span`,
          icon: DollarSign
        },
        {
          label: 'Outstanding Deposits',
          value: formatCurrency(accrualSummary.outstandingDeposits || 0),
          sublabel: 'Held until checkout',
          icon: CreditCard
        },
        {
          label: 'Released Deposits',
          value: formatCurrency(accrualSummary.releasedDeposits || 0),
          sublabel: 'Leases completed',
          icon: TrendingUp
        },
        {
          label: 'Occupied Nights',
          value: formatNumber(accrualSummary.occupiedNights || 0),
          sublabel: `Avg nightly ${accrualSummary.averageNightlyRate ? formatCurrency(accrualSummary.averageNightlyRate) : formatCurrency(0)}`,
          icon: Calendar
        }
      ];

  const basisDescription = selectedBasis === 'cash'
    ? 'Cash basis highlights what actually hit the bank during the selected period.'
    : 'Accrual basis recognizes revenue in the month the stay occurs, regardless of when payment clears.';

  const monthKeys = Object.keys(cashMonthlyRevenue).sort();
  const maxBarValue = monthKeys.reduce((max, key) => {
    return Math.max(max, cashMonthlyRevenue[key] || 0, accrualMonthlyRevenue[key] || 0);
  }, 0) || 1;
  const occupancyRows = monthKeys.slice(-6).reverse().map((key) => {
    const nights = occupancyByMonth[key] || 0;
    const monthlyEarned = accrualMonthlyRevenue[key] || 0;
    const nightlyRate = nights > 0 ? Math.round(monthlyEarned / nights) : 0;
    return {
      key,
      label: formatMonthLabel(key),
      nights,
      nightlyRate
    };
  });

  const payments = revenueData.payments || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNavbar />

      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Revenue Dashboard</h1>
              <p className="text-gray-600">Monitor cash received, accrued rent, and business tax essentials.</p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleExportCsv}
                className="flex items-center px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Period:</span>
              </div>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Time</option>
                <option value="year">Year</option>
                <option value="month">Month</option>
              </select>
              {selectedPeriod !== 'all' && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              )}
              {selectedPeriod === 'month' && (
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {monthOptions.map((month) => (
                    <option key={month.value} value={month.value}>{month.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">Basis:</span>
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  onClick={() => setSelectedBasis('cash')}
                  className={`px-4 py-2 text-sm font-medium transition ${selectedBasis === 'cash' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Cash
                </button>
                <button
                  onClick={() => setSelectedBasis('accrual')}
                  className={`px-4 py-2 text-sm font-medium transition ${selectedBasis === 'accrual' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Accrual
                </button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm text-gray-600 mb-3">{basisDescription}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{card.label}</p>
                      <p className="text-2xl font-bold text-gray-900 mt-2">{card.value}</p>
                      <p className="text-sm text-gray-500 mt-1">{card.sublabel}</p>
                    </div>
                    <span className="p-2 bg-blue-50 rounded-full text-blue-600">
                      <Icon className="h-5 w-5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <PieChart className="h-5 w-5 mr-2 text-blue-600" />
              Revenue Composition
            </h3>
            {revenueByTypeEntries.length === 0 ? (
              <p className="text-sm text-gray-500">No payments recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {revenueByTypeEntries.map(([type, info]) => {
                  const percentage = totalRevenueByType > 0 ? (info.amount / totalRevenueByType) * 100 : 0;
                  return (
                    <div key={type}>
                      <div className="flex justify-between text-sm font-medium text-gray-700 mb-1">
                        <span className="capitalize">{type.replace('_', ' ')}</span>
                        <span>{formatCurrency(info.amount)} · {formatPercentage(info.amount, totalRevenueByType)}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-green-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{info.count} payments</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <BarChart3 className="h-5 w-5 mr-2 text-green-600" />
              Deposits & Forecast
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <p className="text-sm text-green-700 font-medium">Outstanding Deposits</p>
                <p className="text-2xl font-bold text-green-900 mt-2">
                  {formatCurrency(accrualSummary.outstandingDeposits || 0)}
                </p>
                <p className="text-xs text-green-600 mt-1">Held for upcoming stays</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-sm text-blue-700 font-medium">Released Deposits</p>
                <p className="text-2xl font-bold text-blue-900 mt-2">
                  {formatCurrency(accrualSummary.releasedDeposits || 0)}
                </p>
                <p className="text-xs text-blue-600 mt-1">Lease obligations met</p>
              </div>
            </div>
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-700">Upcoming Earned Revenue</p>
              <p className="text-xl font-bold text-gray-900 mt-2">
                {formatCurrency(accrualSummary.upcomingRevenue || 0)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Projected rent beyond the current month</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Calendar className="h-5 w-5 mr-2 text-blue-600" />
              Monthly Performance (Last 12 Months)
            </h3>
            {monthKeys.length === 0 ? (
              <p className="text-sm text-gray-500">No monthly data available.</p>
            ) : (
              <div className="space-y-3">
                {monthKeys.map((monthKey) => {
                  const cashAmount = cashMonthlyRevenue[monthKey] || 0;
                  const accrualAmount = accrualMonthlyRevenue[monthKey] || 0;
                  const cashPercent = Math.round((cashAmount / maxBarValue) * 100);
                  const accrualPercent = Math.round((accrualAmount / maxBarValue) * 100);
                  return (
                    <div key={monthKey} className="border-b border-gray-100 pb-2 last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{formatMonthLabel(monthKey)}</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center text-[11px] text-gray-500">
                          <span className="w-14">Cash</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${cashPercent}%` }} />
                          </div>
                          <span className="ml-2 text-gray-700">{formatCurrency(cashAmount)}</span>
                        </div>
                        <div className="flex items-center text-[11px] text-gray-500">
                          <span className="w-14">Accrual</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-2 bg-green-500 rounded-full" style={{ width: `${accrualPercent}%` }} />
                          </div>
                          <span className="ml-2 text-gray-700">{formatCurrency(accrualAmount)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="h-5 w-5 mr-2 text-purple-600" />
              Occupancy Snapshot
            </h3>
            {occupancyRows.length === 0 ? (
              <p className="text-sm text-gray-500">No lease data yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {occupancyRows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{row.label}</p>
                      <p className="text-xs text-gray-500">{row.nights} nights recognized</p>
                    </div>
                    <div className="text-sm font-semibold text-green-600">
                      {row.nightlyRate ? `${formatCurrency(row.nightlyRate)}/night` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Recent Payments</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Application</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payments.map((payment) => (
                  <tr key={payment._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {payment.applicationId
                              ? `${payment.applicationId.firstName} ${payment.applicationId.lastName}`
                              : payment.userId
                                ? `${payment.userId.firstName} ${payment.userId.lastName}`
                                : 'Unknown Customer'}
                          </div>
                          <div className="text-sm text-gray-500">
                            {payment.applicationId?.applicationNumber ||
                              (payment.userId ? payment.userId.email : `Payment ID: ${payment._id.slice(-8)}`)}
                          </div>
                        </div>
                        {!payment.applicationId && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                            Unlinked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                        {payment.paymentType?.replace('_', ' ') || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatCurrency(payment.amount || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {payment.paidAt
                        ? new Date(payment.paidAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                        : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminRevenueDashboard;
