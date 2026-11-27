"""Rewrite DocAligner's BiFPN weighted sums, einsum('i,i...->...'), as Reshape+Mul+ReduceSum.

The TFLite converter lowers that einsum to BATCH_MATMUL with a wrong layout (measured 2026-11-25: the
TF SavedModel matches ONNX to 4e-6, the .tflite differs by up to 1.97 at the first such node). The
replacement is the same arithmetic: w[i] * x[i, ...] summed over i.
"""
import sys, numpy as np, onnx
from onnx import helper, numpy_helper
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src); g = m.graph
shape_name = 'einsum_rewrite_w_shape'
g.initializer.append(numpy_helper.from_array(np.array([-1, 1, 1, 1, 1], dtype=np.int64), shape_name))
axes_name = 'einsum_rewrite_axes0'
g.initializer.append(numpy_helper.from_array(np.array([0], dtype=np.int64), axes_name))
new_nodes, count = [], 0
for n in g.node:
    eq = next((helper.get_attribute_value(a) for a in n.attribute if a.name == 'equation'), None) if n.op_type == 'Einsum' else None
    if eq is None:
        new_nodes.append(n); continue
    assert eq == b'i,i...->...', eq
    w, x = n.input; out = n.output[0]; base = n.name or out
    new_nodes += [
        helper.make_node('Reshape', [w, shape_name], [base + '/w5'], name=base + '/Reshape'),
        helper.make_node('Mul', [base + '/w5', x], [base + '/wx'], name=base + '/Mul'),
        helper.make_node('ReduceSum', [base + '/wx', axes_name], [out], name=base + '/ReduceSum', keepdims=0),
    ]
    count += 1
del g.node[:]; g.node.extend(new_nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('rewrote', count, 'einsum nodes')
