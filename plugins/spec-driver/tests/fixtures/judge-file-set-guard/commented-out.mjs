// fixture: 注释掉的伪 import——整行处于 // 或 /* */ 内，既不计入 refs 也不计入 unsupported
// import '../not-a-real-dependency.mjs';
/*
import '../another-fake.mjs';
*/
import real from '../lib/foo.mjs';

export default real;
