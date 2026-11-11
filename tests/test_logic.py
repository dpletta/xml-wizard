import unittest

from xml_wizard import logic
from xml_wizard.model import Field


def ev(text, **row):
    return logic.evaluate(logic.parse(text), {k: str(v) for k, v in row.items()})


class ParseTests(unittest.TestCase):
    def test_simple_comparison(self):
        ast = logic.parse("[ever_homeless] = '1'")
        self.assertEqual(ast["type"], "cmp")
        self.assertEqual(ast["left"], {"type": "ref", "field": "ever_homeless", "code": None, "event": None})

    def test_and_or_precedence(self):
        ast = logic.parse("[a] = '1' or [b] = '1' and [c] = '1'")
        self.assertEqual(ast["op"], "or")
        self.assertEqual(ast["args"][1]["op"], "and")

    def test_checkbox_and_event_refs(self):
        refs = logic.references(logic.parse("[race(98)] = '1' and [baseline_arm_1][age] >= 18"))
        self.assertEqual(refs[0]["code"], "98")
        self.assertEqual(refs[1]["event"], "baseline_arm_1")
        self.assertEqual(logic.column_for(refs[0]), "race___98")

    def test_operators_and_case(self):
        for text in ("[a] <> '1'", "[a] != '1'", "[a]='1' AND [b]='2'", "[a]='1' && [b]='2'",
                     "[a] >= 2 OR [b] <= -1", "not([a] = '1')", "([a] = '1')"):
            logic.parse(text)  # does not raise

    def test_functions_and_smart_vars(self):
        ast = logic.parse("sum([a], [b]) > 3 and [current-instance] = '1' and datediff([d1], 'today', 'y') > 18")
        self.assertIn("smart variable [current-instance]", logic.unsupported_features(ast))
        self.assertEqual(logic.functions_used(ast), ["datediff", "sum"])

    def test_html_entities_from_xml(self):
        ast = logic.parse("[a] &lt;&gt; '1'")
        self.assertEqual(ast["op"], "<>")

    def test_syntax_errors(self):
        for bad in ("[a] = ", "[a] = '1' and", "a = '1'", "([a] = '1'", "[a] = '1')", ""):
            with self.assertRaises(logic.LogicSyntaxError, msg=bad):
                logic.parse(bad)


class EvaluateTests(unittest.TestCase):
    def test_equality_and_blank(self):
        self.assertTrue(ev("[a] = '1'", a="1"))
        self.assertFalse(ev("[a] = '1'", a=""))
        self.assertTrue(ev("[a] = ''", a=""))
        self.assertTrue(ev("[a] <> ''", a="x"))
        self.assertTrue(ev("[a] <> '1'", a=""))

    def test_numeric_comparisons(self):
        self.assertTrue(ev("[a] = '1'", a="1.0"))
        self.assertTrue(ev("[a] > 2", a="10"))   # numeric, not string, comparison
        self.assertFalse(ev("[a] > 2", a=""))    # blank never satisfies < or >
        self.assertFalse(ev("[a] < 2", a=""))

    def test_checkbox(self):
        self.assertTrue(ev("[race(3)] = '1'", race___3="1"))
        self.assertFalse(ev("[race(3)] = '1'", race___3="0"))

    def test_boolean_logic(self):
        self.assertTrue(ev("[a] = '1' and ([b] = '1' or [c] = '1')", a=1, b=0, c=1))
        self.assertFalse(ev("[a] = '1' and ([b] = '1' or [c] = '1')", a=1, b=0, c=0))
        self.assertTrue(ev("not([a] = '1')", a=0))

    def test_arithmetic_and_functions(self):
        self.assertTrue(ev("[a] + [b] >= 5", a=2, b=3))
        self.assertFalse(ev("[a] + [b] >= 5", a=2, b=""))
        self.assertTrue(ev("sum([a], [b]) = 2", a=2, b=""))
        self.assertTrue(ev("if([a] = '1', 10, 0) = 10", a=1))
        self.assertTrue(ev("contains([t], 'abc')", t="xxABCxx"))
        self.assertTrue(ev("datediff([d1], [d2], 'd') = 31", d1="2024-01-01", d2="2024-02-01"))

    def test_unknown_is_none(self):
        self.assertIsNone(ev("[current-instance] = '1'"))
        self.assertIsNone(ev("weird_fn([a]) = 1", a=1))
        self.assertFalse(ev("[a] = '1' and [current-instance] = '1'", a=0))  # False wins in AND

    def test_python_translation_matches_evaluator(self):
        from xml_wizard import runtime
        env = {k: getattr(runtime, k) for k in dir(runtime) if k.startswith("rc_")}
        cases = [("[a] = '1' and [b] > 3", {"a": "1", "b": "4"}),
                 ("[a] = '1' and [b] > 3", {"a": "1", "b": ""}),
                 ("[x(2)] = '1' or [y] <> ''", {"x___2": "0", "y": ""}),
                 ("sum([a],[b]) / 2 >= 1.5", {"a": "1", "b": "2"})]
        for text, row in cases:
            ast = logic.parse(text)
            fn = eval("lambda r: " + logic.to_python(ast), env)
            self.assertEqual(runtime.to_bool(fn(row)), runtime.to_bool(logic.evaluate(ast, row)), text)


class TextTests(unittest.TestCase):
    def test_plain_english_uses_labels(self):
        fields = {
            "ever": Field("ever", "f", "yesno", label="Ever?"),
            "race": Field("race", "f", "checkbox", choices=[("98", "Another race")]),
        }
        text = logic.to_text(logic.parse("[ever] = '1' and [race(98)] = '1'"), fields.get)
        self.assertEqual(text, 'ever is "Yes" (1) AND race: "Another race" is checked')
        self.assertEqual(logic.to_text(logic.parse("[x] <> ''")), "x is answered")


if __name__ == "__main__":
    unittest.main()
