'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var tax = require('../lib/tax');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function orderFixture(overrides) {
  var items = [{
    id: 7,
    name: 'Rice',
    sku: 'GRN-007',
    hsn: '1006',
    price: 1000,
    qty: 1
  }];
  var totals = pricing.computeTotals(items, 'SAVE10');
  var order = {
    id: 42,
    date: '21/11/2026',
    customer: 'Test Customer',
    paymentMode: 'cash',
    status: 'completed',
    coupon: 'SAVE10',
    items: items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
  Object.keys(overrides || {}).forEach(function (key) { order[key] = overrides[key]; });
  return order;
}

test('invoice figures match the billed order for HSN GST and a coupon', function () {
  var order = orderFixture();
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.discount, order.discount);
  assert.equal(figures.tax, order.tax);
  assert.equal(figures.total, order.total);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 45);
});

test('CURRENT BEHAVIOUR: pricing applies the HSN slab to post-coupon taxable value', function () {
  var order = orderFixture();
  var totals = pricing.computeTotals(order.items, order.coupon);

  assert.equal(totals.subtotal, 1000);
  assert.equal(totals.discount, 100);
  assert.equal(totals.taxable, 900);
  assert.equal(totals.tax, 45);
  assert.equal(totals.cgst, 22.5);
  assert.equal(totals.sgst, 22.5);
  assert.equal(totals.total, 945);
  assert.equal(tax.getSlabPercent(order.items[0]), 5);
});

test('invoice uses the HSN tax slab and applies the coupon before tax', function () {
  var figures = invoice.computeInvoiceFigures(orderFixture());

  assert.equal(figures.subtotal, 1000);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 45);
  assert.equal(figures.tax, 45);
  assert.equal(figures.discount, 100);
  assert.equal(figures.total, 945);
  assert.equal(figures.cgst, 22.5);
  assert.equal(figures.sgst, 22.5);
});

test('invoice and pricing interpret a fractional gstRate the same way', function () {
  var items = [{ id: 8, name: 'Explicit rate', price: 100, qty: 1, gstRate: 0.05 }];
  var order = { items: items, coupon: '' };
  var priced = pricing.computeTotals(items, '');
  var invoiced = invoice.computeInvoiceFigures(order);

  assert.equal(priced.tax, 5);
  assert.equal(invoiced.rows[0].gstPercent, 5);
  assert.equal(invoiced.tax, 5);
});

test('GST reconciliation matches invoice and ledger after shared pricing', function () {
  var order = orderFixture();
  var result = reports.getGstReconciliation({ orders: [order] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.rows[0].ledgerTax, 45);
  assert.equal(result.rows[0].invoiceTax, 45);
  assert.equal(result.rows[0].ledgerTotal, 945);
  assert.equal(result.rows[0].invoiceTotal, 945);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});

test('CURRENT BEHAVIOUR: reconciliation excludes cancelled orders', function () {
  var result = reports.getGstReconciliation({
    orders: [orderFixture({ status: 'cancelled' })]
  });

  assert.equal(result.totalChecked, 0);
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.rows, []);
});
