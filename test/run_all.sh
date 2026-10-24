#!/bin/sh
# Runs every automated check: engine PDF export in four PDF engines, then the app end to end.
# Needs: node, python3 (numpy, scipy, pillow, pypdfium2, pikepdf), poppler-utils, ghostscript, qpdf, xvfb.
cd "$(dirname "$0")/.." || exit 1
# test drawings (made by testdata/*.py) live in testdata/out unless PLANTINT_TESTDATA says otherwise
if [ ! -d "${PLANTINT_TESTDATA:-testdata/out}" ]; then
  mkdir -p testdata/out && python3 testdata/make_plans.py testdata/out && python3 testdata/make_more.py testdata/out && python3 testdata/make_layers.py testdata/out/plan_A3_single.pdf testdata/out/plan_layers.pdf && python3 testdata/make_layout.py testdata/out || exit 1
fi
[ "$PLANTINT_NO_BUILD" = 1 ] || node build.mjs || exit 1
fails=0
for u in measure progress cover; do
  printf '%-18s ' "unit $u"
  if node --no-warnings "test/unit/${u}_test.mjs" > "/tmp/plantint-unit-$u.log" 2>&1; then tail -1 "/tmp/plantint-unit-$u.log"
  else echo "FAILED (see /tmp/plantint-unit-$u.log)"; grep FAIL "/tmp/plantint-unit-$u.log"; fails=$((fails+1)); fi
done
node test/harness/pdf_export_test.mjs >/dev/null && python3 test/pdfcheck/check_basic.py | tail -1 && python3 test/pdfcheck/check_layers.py | tail -1 || fails=$((fails+1))
for t in t0_regression t1_pdf_export t1b_sources t2_rect t3_linestyle t4_detect t5_eraser t6_measure t7_tabs t8_recovery t9_progress_snags t10_cover t11_markups_window; do
  printf '%-18s ' "$t"
  if xvfb-run -a -s "-screen 0 1920x1080x24" node "test/e2e/$t.mjs" > "/tmp/plantint-$t.log" 2>&1; then
    tail -1 "/tmp/plantint-$t.log"
  else
    echo "FAILED (see /tmp/plantint-$t.log)"; grep FAIL "/tmp/plantint-$t.log"; fails=$((fails+1))
  fi
done
# the app's own PDF exports against its PNG export, in four PDF engines
O="${PLANTINT_TEST_OUT:-/tmp/plantint-test}/e2e"
python3 test/pdfcheck/check_app.py $O/t1.png $O/t1_vector.pdf $O/t1_flat.pdf | tail -1 || fails=$((fails+1))
for t in rot crop jpg g4 layers; do python3 test/pdfcheck/check_app.py $O/t1b_$t.png $O/t1b_${t}_vector.pdf $O/t1b_${t}_flat.pdf | tail -1 || fails=$((fails+1)); done
echo "failed suites: $fails"
exit $fails
